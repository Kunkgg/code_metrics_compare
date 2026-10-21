"""Cmetrics 扫描数据生成与校验命令行工具.

支持独立生成模拟数据、baseline/current 对照组，以及执行 L0–L3 校验.
"""

import argparse
import json
import sys
from pathlib import Path

from cmetrics_cmp_viz.generator import GeneratorConfig, MockDataGenerator
from cmetrics_cmp_viz.validator import (
    validate_l0,
    validate_l1,
    validate_l2,
    validate_l3,
)


def run_validate(args: argparse.Namespace) -> int:
    """运行文件校验."""
    target_file = Path(args.file)
    if not target_file.exists():
        print(f"错误: 文件未找到: {target_file}", file=sys.stderr)
        return 1

    try:
        raw_bytes = target_file.read_bytes()
    except Exception as e:
        print(f"错误: 读取文件失败: {e}", file=sys.stderr)
        return 1

    level = args.level.upper()
    print(f"[*] 开始对 {target_file.name} 执行 {level} 层级校验...")

    # L0
    data, l0_errs = validate_l0(raw_bytes)
    if l0_errs:
        print(f"[FAIL] L0 校验未通过 ({len(l0_errs)} 个错误):")
        for err in l0_errs:
            print(f"  - {err}")
        return 1
    print("[PASS] L0: JSON 语法与基本数值规则校验通过")
    if level == "L0":
        return 0

    assert data is not None

    # L1
    l1_errs = validate_l1(data)
    if l1_errs:
        print(f"[FAIL] L1 Schema 校验未通过 ({len(l1_errs)} 个错误):")
        for err in l1_errs:
            print(f"  - {err}")
        return 1
    print("[PASS] L1: Draft 2020-12 Schema 契约校验通过")
    if level == "L1":
        return 0

    # L2
    l2_errs = validate_l2(data)
    if l2_errs:
        print(f"[FAIL] L2 语义校验未通过 ({len(l2_errs)} 个错误):")
        for err in l2_errs:
            print(f"  - {err}")
        return 1
    print("[PASS] L2: 引用完整性、行号范围、命令与 33 项汇总公式复算通过")
    if level == "L2":
        return 0

    # L3
    if level == "L3":
        model_file = args.internal_model
        if not model_file:
            print("提示: L3 校验需要 --internal-model 提供内部行覆盖模型", file=sys.stderr)
            return 1
        m_path = Path(model_file)
        if not m_path.exists():
            print(f"错误: 内部模型文件未找到: {m_path}", file=sys.stderr)
            return 1
        with open(m_path, encoding="utf-8") as f:
            int_model = json.load(f)
        l3_errs = validate_l3(data, int_model)
        if l3_errs:
            print(f"[FAIL] L3 校验未通过 ({len(l3_errs)} 个错误):")
            for err in l3_errs:
                print(f"  - {err}")
            return 1
        print("[PASS] L3: 内部重复行覆盖并集与模型一致性校验通过")

    print("[SUCCESS] 指定级别全部校验通过！")
    return 0


def run_generate(args: argparse.Namespace) -> int:
    """生成模拟扫描报告."""
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = GeneratorConfig(
        seed=args.seed,
        num_files=args.num_files,
        cmetrics_version=args.cmetrics_version,
    )
    generator = MockDataGenerator(cfg)

    if args.pair:
        print(
            f"[*] 生成 baseline 与 current 一组扫描数据 (seed={args.seed}, files={args.num_files})..."
        )
        b_report, c_report, ledger = generator.generate_baseline_and_current()

        b_file = out_dir / "baseline.json"
        c_file = out_dir / "current.json"
        ledger_file = out_dir / "change_ledger.json"

        b_file.write_text(json.dumps(b_report, indent=2, ensure_ascii=False), encoding="utf-8")
        c_file.write_text(json.dumps(c_report, indent=2, ensure_ascii=False), encoding="utf-8")
        ledger_file.write_text(json.dumps(ledger, indent=2, ensure_ascii=False), encoding="utf-8")

        print(f"[+] Baseline 报告已生成: {b_file}")
        print(f"[+] Current 报告已生成: {c_file}")
        print(f"[+] 变化台账已生成: {ledger_file} ({len(ledger)} 条变更)")
    else:
        print(f"[*] 生成单个模拟扫描数据 (seed={args.seed}, files={args.num_files})...")
        report, int_model = generator.generate_single_report()

        out_file = out_dir / "mock_scan.json"
        model_file = out_dir / "internal_model.json"

        out_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        model_file.write_text(json.dumps(int_model, indent=2, ensure_ascii=False), encoding="utf-8")

        print(f"[+] 扫描数据已生成: {out_file}")
        print(f"[+] 内部模型已生成: {model_file}")

    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI 入口."""
    parser = argparse.ArgumentParser(description="Cmetrics 模拟扫描数据生成与校验工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # generate 子命令
    p_gen = subparsers.add_parser("generate", help="生成模拟扫描数据")
    p_gen.add_argument("--output-dir", "-o", default="./mock_output", help="输出目录")
    p_gen.add_argument("--seed", "-s", type=int, default=42, help="随机种子")
    p_gen.add_argument("--num-files", "-n", type=int, default=20, help="生成文件数量")
    p_gen.add_argument("--pair", action="store_true", help="是否生成 baseline/current 变化对")
    p_gen.add_argument("--cmetrics-version", default="mock-scan-v1.0.0", help="扫描工具版本串")
    p_gen.set_defaults(func=run_generate)

    # validate 子命令
    p_val = subparsers.add_parser("validate", help="校验扫描 JSON 文件")
    p_val.add_argument("file", help="要校验的 JSON 文件路径")
    p_val.add_argument(
        "--level",
        "-l",
        choices=["L0", "L1", "L2", "L3"],
        default="L2",
        help="校验级别 (默认 L2)",
    )
    p_val.add_argument("--internal-model", help="内部模型文件 (L3 校验必需)")
    p_val.set_defaults(func=run_validate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
