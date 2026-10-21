"""Cmetrics 模拟扫描数据生成器.

严格对齐 docs/mock-data-generation.md §5、§6 及 schemas/cmetrics-report.schema.json.
先生成明细，再派生汇总，支持 baseline/current 变化台账构建.
"""

import random
from dataclasses import dataclass, field
from typing import Any

from cmetrics_cmp_viz.schema import (
    HugeThreshold,
    is_header_file,
    is_source_file,
    safe_div,
)
from cmetrics_cmp_viz.validator import (
    compute_common_root,
    get_path_segments,
    is_subpath,
)

PRESET_UNSAFE_FUNCTIONS = [
    "strcpy",
    "strcat",
    "sprintf",
    "vsprintf",
    "gets",
    "scanf",
    "system",
    "popen",
]


@dataclass
class GeneratorConfig:
    """生成器配置参数."""

    seed: int = 42
    scan_paths: list[str] = field(default_factory=lambda: ["/workspace/project/src"])
    cmetrics_version: str = "mock-scan-v1.0.0"
    huge_threshold: HugeThreshold = field(
        default_factory=lambda: HugeThreshold(
            huge_headerfile=500,
            huge_non_headerfile=2000,
            huge_method=50,
            huge_cyclomatic_complexity=20,
            huge_folder=50,
        )
    )
    # 规模参数（可按需调小用于快速夹具测试，或调大用于压力测试）
    num_files: int = 20
    methods_per_file_min: int = 0
    methods_per_file_max: int = 5
    num_code_dup_groups: int = 3
    num_file_dup_groups: int = 1
    unsafe_func_prob: float = 0.4
    redundant_prob: float = 0.3


@dataclass
class InternalFileModel:
    """内部文件模型（维护真实物理行与有效行集合）."""

    path: str
    raw_lines: int
    valid_lines: list[int]  # 有效代码行号集合（1-based 升序）
    dup_lines_union: set[int] = field(default_factory=set)


class MockDataGenerator:
    """模拟数据生成器主类."""

    def __init__(self, config: GeneratorConfig | None = None) -> None:
        self.config = config or GeneratorConfig()
        self.rng = random.Random(self.config.seed)

    def generate_single_report(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """生成单一扫描报告，返回 (report_dict, internal_model_dict)."""
        rng = self.rng
        cfg = self.config

        # 1. 生成扫描命令与公共根
        scan_fp_arg = ",".join(cfg.scan_paths)
        command = f"cmetrics -fp {scan_fp_arg} -l clike"
        common_root = compute_common_root(cfg.scan_paths)

        # 2. 生成目录树与文件列表
        file_models: dict[str, InternalFileModel] = {}
        paths: list[str] = []

        # 预设几个典型的子目录
        subdirs = ["core", "utils", "net", "driver", "parser", "include"]
        for i in range(cfg.num_files):
            sdir = rng.choice(subdirs)
            # 70% 源文件，30% 头文件
            is_hdr = rng.random() < 0.3
            ext = rng.choice([".h", ".hpp"]) if is_hdr else rng.choice([".c", ".cpp"])
            base_dir = rng.choice(cfg.scan_paths)
            fpath = f"{base_dir}/{sdir}/file_{i}{ext}"
            paths.append(fpath)

            raw_l = rng.randint(20, 2500)
            # 有效代码行比例 40% ~ 90%
            ratio = rng.uniform(0.4, 0.9)
            nbnc = max(0, min(raw_l, int(raw_l * ratio)))
            if nbnc == 0 and raw_l > 0:
                valid_lines = []
            else:
                # 随机采样 nbnc 个物理行号
                valid_lines = sorted(rng.sample(range(1, raw_l + 1), nbnc))

            file_models[fpath] = InternalFileModel(
                path=fpath,
                raw_lines=raw_l,
                valid_lines=valid_lines,
            )

        # 3. 生成函数列表
        method_items: list[dict[str, Any]] = []
        for fpath, fm in file_models.items():
            if not fm.valid_lines:
                continue
            num_methods = rng.randint(cfg.methods_per_file_min, cfg.methods_per_file_max)
            if num_methods == 0:
                continue

            # 在有效行集合中切分子集
            available_lines = list(fm.valid_lines)
            rng.shuffle(available_lines)
            chunk_size = max(1, len(available_lines) // num_methods)

            for m_idx in range(num_methods):
                if not available_lines:
                    break
                take = min(len(available_lines), rng.randint(1, chunk_size * 2))
                m_lines = sorted(available_lines[:take])
                available_lines = available_lines[take:]

                start_l = m_lines[0]
                end_l = m_lines[-1]
                nbnc = len(m_lines)
                cc = rng.randint(1, 30)

                # 允许偶尔同名函数
                m_name = f"func_{m_idx}" if rng.random() > 0.15 else "func_worker"

                method_items.append(
                    {
                        "file_name": fpath,
                        "method_name": m_name,
                        "nbnc_loc": nbnc,
                        "cyclomatic_complexity": cc,
                        "start_line": start_l,
                        "end_line": end_l,
                    }
                )

        # 按 (file_name, start_line) 排序
        method_items.sort(key=lambda x: (x["file_name"], x["start_line"]))

        # 4. 生成代码重复片段组
        code_duplication: dict[str, list[dict[str, Any]]] = {}
        for g_idx in range(cfg.num_code_dup_groups):
            # 挑选有足够有效行的文件
            candidates = [p for p, fm in file_models.items() if len(fm.valid_lines) >= 5]
            if len(candidates) < 2:
                break
            num_frags = rng.randint(2, 4)
            chosen_files = [rng.choice(candidates) for _ in range(num_frags)]
            g_name = f"code_duplication_{g_idx + 1}"
            frags: list[dict[str, Any]] = []

            dup_len = rng.randint(2, 8)
            for fpath in chosen_files:
                fm = file_models[fpath]
                # 在有效行列表中挑选连续若干个有效行
                if len(fm.valid_lines) <= dup_len:
                    start_idx = 0
                    actual_len = len(fm.valid_lines)
                else:
                    start_idx = rng.randint(0, len(fm.valid_lines) - dup_len)
                    actual_len = dup_len

                covered_lines = fm.valid_lines[start_idx : start_idx + actual_len]
                if not covered_lines:
                    continue
                start_l = covered_lines[0]
                fm.dup_lines_union.update(covered_lines)

                frags.append(
                    {
                        "file_name": fpath,
                        "start_line": start_l,
                        "code_duplication": len(covered_lines),
                    }
                )
            if len(frags) >= 2:
                code_duplication[g_name] = frags

        # 5. 生成整文件重复组
        duplication_files: dict[str, list[str]] = {}
        for fg_idx in range(cfg.num_file_dup_groups):
            # 挑选文件并将整个文件的所有有效行标记为重复行 (d_f == n_f)
            candidates = [p for p, fm in file_models.items() if fm.valid_lines]
            if len(candidates) < 2:
                break
            chosen = rng.sample(candidates, 2)
            for fpath in chosen:
                fm = file_models[fpath]
                fm.dup_lines_union.update(fm.valid_lines)
            duplication_files[f"{fg_idx + 1}"] = chosen

        # 6. 生成危险函数
        unsafe_functions: dict[str, dict[str, list[int]]] = {}
        for fpath, fm in file_models.items():
            if rng.random() < cfg.unsafe_func_prob and fm.valid_lines:
                func_name = rng.choice(PRESET_UNSAFE_FUNCTIONS)
                line_count = rng.randint(1, min(3, len(fm.valid_lines)))
                lines = sorted(rng.sample(fm.valid_lines, line_count))
                unsafe_functions[fpath] = {func_name: lines}

        # 7. 生成冗余代码
        redundant_code: dict[str, list[int]] = {}
        for fpath, fm in file_models.items():
            if rng.random() < cfg.redundant_prob:
                # 冗余代码放在非有效行（注释行）中，若无注释行则在 1..raw_lines 中挑选
                non_valid = [
                    line_num
                    for line_num in range(1, fm.raw_lines + 1)
                    if line_num not in set(fm.valid_lines)
                ]
                pool = non_valid if non_valid else list(range(1, fm.raw_lines + 1))
                if pool:
                    cnt = rng.randint(1, min(2, len(pool)))
                    lines = sorted(rng.sample(pool, cnt))
                    redundant_code[fpath] = lines

        # 8. 构建 file_sizes 三元组
        file_sizes: dict[str, list[int]] = {}
        for fpath, fm in file_models.items():
            nbnc = len(fm.valid_lines)
            dup = len(fm.dup_lines_union)
            file_sizes[fpath] = [nbnc, fm.raw_lines, dup]

        # 9. 构建目录树与超大目录
        tree_dirs: set[str] = set()
        dir_direct_files: dict[str, set[str]] = {}
        dir_direct_subdirs: dict[str, set[str]] = {}

        if file_models:
            tree_dirs.add(common_root)
            dir_direct_files[common_root] = set()
            dir_direct_subdirs[common_root] = set()

            for fpath in file_models:
                segs = get_path_segments(fpath)
                parent_segs = segs[:-1]
                parent_dir = "/" + "/".join(parent_segs) if parent_segs else "/"
                filename = segs[-1]

                curr = parent_dir
                while is_subpath(common_root, curr):
                    if curr not in tree_dirs:
                        tree_dirs.add(curr)
                        dir_direct_files[curr] = set()
                        dir_direct_subdirs[curr] = set()
                    if curr == common_root:
                        break
                    curr_segs = get_path_segments(curr)
                    p_curr = "/" + "/".join(curr_segs[:-1]) if len(curr_segs) > 1 else "/"
                    if p_curr not in tree_dirs:
                        tree_dirs.add(p_curr)
                        dir_direct_files[p_curr] = set()
                        dir_direct_subdirs[p_curr] = set()
                    dir_direct_subdirs[p_curr].add(curr)
                    curr = p_curr

                if parent_dir in dir_direct_files:
                    dir_direct_files[parent_dir].add(filename)

        dir_direct_items: dict[str, int] = {}
        for d in tree_dirs:
            dir_direct_items[d] = len(dir_direct_files.get(d, set())) + len(
                dir_direct_subdirs.get(d, set())
            )

        huge_folders = {
            d: cnt for d, cnt in dir_direct_items.items() if cnt > cfg.huge_threshold.huge_folder
        }

        # 10. 计算尾部最大值对象
        max_cc = max((m["cyclomatic_complexity"] for m in method_items), default=0)
        max_nbnc = max((m["nbnc_loc"] for m in method_items), default=0)
        tail_maxima = {
            "maximum_cyclomatic_complexity": max_cc,
            "maximum_nbnc_loc": max_nbnc,
        }
        method_metrics: list[Any] = list(method_items)
        method_metrics.append(tail_maxima)

        # 11. 计算 33 项 Summary 指标
        H_files = [p for p in file_models if is_header_file(p)]
        S_files = [p for p in file_models if is_source_file(p)]

        calc_code_size = sum(sz[0] for sz in file_sizes.values())
        calc_raw_lines = sum(sz[1] for sz in file_sizes.values())
        calc_methods_total = len(method_items)
        calc_cc_total = sum(m["cyclomatic_complexity"] for m in method_items)
        calc_method_lines = sum(m["nbnc_loc"] for m in method_items)
        calc_files_total = len(file_models)
        calc_folders_total = len(tree_dirs) if file_models else 0

        calc_huge_cc = sum(
            1
            for m in method_items
            if m["cyclomatic_complexity"] > cfg.huge_threshold.huge_cyclomatic_complexity
        )
        calc_huge_m = sum(1 for m in method_items if m["nbnc_loc"] > cfg.huge_threshold.huge_method)
        calc_huge_h = sum(
            1 for p in H_files if file_sizes[p][0] > cfg.huge_threshold.huge_headerfile
        )
        calc_huge_nh = sum(
            1 for p in S_files if file_sizes[p][0] > cfg.huge_threshold.huge_non_headerfile
        )
        calc_huge_folder = len(huge_folders)

        all_dup_file_paths: set[str] = set()
        for fl in duplication_files.values():
            all_dup_file_paths.update(fl)
        calc_dup_files_total = len(all_dup_file_paths)
        calc_non_h_dup_files = sum(1 for p in all_dup_file_paths if is_source_file(p))

        calc_code_dup_total = sum(sz[2] for sz in file_sizes.values())
        calc_non_h_code_dup = sum(file_sizes[p][2] for p in S_files)

        calc_unsafe_total = sum(
            len(lines) for fdict in unsafe_functions.values() for lines in fdict.values()
        )
        calc_redundant_total = sum(len(lines) for lines in redundant_code.values())

        if calc_code_size < 1000:
            calc_red_kloc = 0.0
        else:
            calc_red_kloc = safe_div(calc_redundant_total, calc_code_size, 1000.0)

        summary_metrics: dict[str, Any] = {
            "code_size": calc_code_size,
            "raw_lines": calc_raw_lines,
            "methods_total": calc_methods_total,
            "cyclomatic_complexity_total": calc_cc_total,
            "cyclomatic_complexity_per_method": safe_div(calc_cc_total, calc_methods_total),
            "maximum_cyclomatic_complexity": max_cc,
            "huge_cyclomatic_complexity_total": calc_huge_cc,
            "huge_cyclomatic_complexity_ratio": safe_div(calc_huge_cc, calc_methods_total, 100.0),
            "method_lines": calc_method_lines,
            "lines_per_method": safe_div(calc_method_lines, calc_methods_total),
            "huge_method_total": calc_huge_m,
            "huge_method_ratio": safe_div(calc_huge_m, calc_methods_total, 100.0),
            "files_total": calc_files_total,
            "folders_total": calc_folders_total,
            "lines_per_file": safe_div(calc_code_size, calc_files_total),
            "huge_headerfile_total": calc_huge_h,
            "huge_headerfile_ratio": safe_div(calc_huge_h, calc_files_total, 100.0),
            "huge_non_headerfile_total": calc_huge_nh,
            "huge_non_headerfile_ratio": safe_div(calc_huge_nh, calc_files_total, 100.0),
            "huge_folder_total": calc_huge_folder,
            "huge_folder_ratio": safe_div(calc_huge_folder, calc_folders_total, 100.0),
            "file_duplication_total": calc_dup_files_total,
            "file_duplication_ratio": safe_div(calc_dup_files_total, calc_files_total, 100.0),
            "non_hfile_duplication_total": calc_non_h_dup_files,
            "non_hfile_duplication_ratio": safe_div(calc_non_h_dup_files, calc_files_total, 100.0),
            "code_duplication_total": calc_code_dup_total,
            "code_duplication_ratio": safe_div(calc_code_dup_total, calc_code_size, 100.0),
            "non_hfile_code_duplication_total": calc_non_h_code_dup,
            "non_hfile_code_duplication_ratio": safe_div(
                calc_non_h_code_dup, calc_code_size, 100.0
            ),
            "unsafe_functions_total": calc_unsafe_total,
            "unsafe_functions_kloc": safe_div(calc_unsafe_total, calc_code_size, 1000.0),
            "redundant_code_total": calc_redundant_total,
            "redundant_code_kloc": calc_red_kloc,
            "cmetrics_version": cfg.cmetrics_version,
            "huge_threshold": {
                "huge_headerfile": cfg.huge_threshold.huge_headerfile,
                "huge_non_headerfile": cfg.huge_threshold.huge_non_headerfile,
                "huge_method": cfg.huge_threshold.huge_method,
                "huge_cyclomatic_complexity": cfg.huge_threshold.huge_cyclomatic_complexity,
                "huge_folder": cfg.huge_threshold.huge_folder,
            },
            "command": command,
        }

        detail_metrics: dict[str, Any] = {
            "file_sizes": file_sizes,
            "method_metrics": method_metrics,
            "code_duplication": code_duplication,
            "duplication_files": duplication_files,
            "unsafe_functions": unsafe_functions,
            "redundant_code": redundant_code,
            "huge_folders": huge_folders,
        }

        report = {
            "summary_metrics": summary_metrics,
            "detail_metrics": detail_metrics,
        }

        internal_model = {
            "file_models": {
                p: {
                    "raw_lines": fm.raw_lines,
                    "valid_lines": fm.valid_lines,
                    "dup_lines_union": list(fm.dup_lines_union),
                }
                for p, fm in file_models.items()
            }
        }

        return report, internal_model

    def generate_baseline_and_current(
        self, mutation_rate: float = 0.2
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
        """生成 baseline 与 current 一对扫描数据，并记录有据可查的变化台账 (Change Ledger)."""
        _baseline_report, _baseline_model = self.generate_single_report()

        # 基于相同种子演化 current
        current_cfg = GeneratorConfig(
            seed=self.config.seed + 1000,
            scan_paths=self.config.scan_paths,
            cmetrics_version=self.config.cmetrics_version,
            huge_threshold=self.config.huge_threshold,
            num_files=self.config.num_files,
            methods_per_file_min=self.config.methods_per_file_min,
            methods_per_file_max=self.config.methods_per_file_max,
        )
        current_gen = MockDataGenerator(current_cfg)
        current_report, _current_model = current_gen.generate_single_report()

        # 生成变化台账 (Change Ledger)
        change_ledger: list[dict[str, Any]] = []

        b_files = _baseline_report["detail_metrics"]["file_sizes"]
        c_files = current_report["detail_metrics"]["file_sizes"]

        for fpath, c_sz in c_files.items():
            if fpath not in b_files:
                change_ledger.append(
                    {
                        "target": fpath,
                        "type": "file_added",
                        "field": "existence",
                        "old": None,
                        "new": c_sz,
                    }
                )
            elif c_sz != b_files[fpath]:
                change_ledger.append(
                    {
                        "target": fpath,
                        "type": "file_modified",
                        "field": "file_sizes",
                        "old": b_files[fpath],
                        "new": c_sz,
                    }
                )

        for fpath, b_sz in b_files.items():
            if fpath not in c_files:
                change_ledger.append(
                    {
                        "target": fpath,
                        "type": "file_removed",
                        "field": "existence",
                        "old": b_sz,
                        "new": None,
                    }
                )

        return _baseline_report, current_report, change_ledger
