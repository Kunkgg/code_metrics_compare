"""Cmetrics 扫描数据分层校验器 (L0-L3).

完全实现 docs/mock-data-generation.md §2 与 §7 定义的分级校验体系.
"""

import json
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from cmetrics_cmp_viz.schema import (
    is_header_file,
    is_source_file,
    round_half_up,
    safe_div,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "schemas" / "cmetrics-report.schema.json"
)


def _no_constants(val: str) -> None:
    raise ValueError(f"JSON contains non-standard constant: {val}")


def validate_l0(raw_text: str | bytes) -> tuple[dict[str, Any] | None, list[str]]:
    """L0 校验：检查 JSON 语法、拦截重复键、拦截 NaN/Infinity."""
    errors: list[str] = []
    if isinstance(raw_text, bytes):
        try:
            text = raw_text.decode("utf-8")
        except UnicodeDecodeError as e:
            return None, [f"L0: 非法 UTF-8 编码: {e}"]
    else:
        text = raw_text

    def object_pairs_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        d: dict[str, Any] = {}
        for k, v in pairs:
            if k in d:
                errors.append(f"L0: 检测到重复的对象键 '{k}'")
            d[k] = v
        return d

    try:
        data = json.loads(
            text,
            object_pairs_hook=object_pairs_hook,
            parse_constant=_no_constants,
        )
    except Exception as e:
        return None, [f"L0: JSON 解析失败: {e}"]

    if errors:
        return None, errors
    if not isinstance(data, dict):
        return None, ["L0: 顶层必须是 JSON 对象"]
    return data, []


def validate_l1(data: dict[str, Any], schema_file: Path | None = None) -> list[str]:
    """L1 校验：基于 JSON Schema Draft 2020-12 校验结构契约."""
    s_path = schema_file or SCHEMA_PATH
    if not s_path.exists():
        return [f"L1: Schema 文件未找到: {s_path}"]

    try:
        with open(s_path, encoding="utf-8") as f:
            schema = json.load(f)
    except Exception as e:
        return [f"L1: 加载 Schema 失败: {e}"]

    validator = Draft202012Validator(schema)
    errors: list[str] = []
    for err in sorted(validator.iter_errors(data), key=lambda e: e.path):
        loc = " -> ".join(str(p) for p in err.path) if err.path else "root"
        errors.append(f"L1: [{loc}] {err.message}")
    return errors


def get_path_segments(path: str) -> list[str]:
    """将绝对路径解析为非空路径段列表."""
    return [seg for seg in path.strip("/").split("/") if seg]


def compute_common_root(paths: list[str]) -> str:
    """按路径段计算最长公共祖先目录路径."""
    if not paths:
        return "/"
    split_paths = [get_path_segments(p) for p in paths]
    min_len = min(len(p) for p in split_paths)
    common: list[str] = []
    for i in range(min_len):
        seg = split_paths[0][i]
        if all(sp[i] == seg for sp in split_paths):
            common.append(seg)
        else:
            break
    return "/" + "/".join(common) if common else "/"


def is_subpath(parent: str, child: str) -> bool:
    """判断 child 是否位于 parent 目录之下（按路径段比对）."""
    p_segs = get_path_segments(parent)
    c_segs = get_path_segments(child)
    if len(c_segs) < len(p_segs):
        return False
    return c_segs[: len(p_segs)] == p_segs


def validate_l2(data: dict[str, Any]) -> list[str]:
    """L2 语义校验：校验尾对象、引用完整性、行号范围、命令与公共根、超大目录及33项汇总公式."""
    errors: list[str] = []

    summary = data.get("summary_metrics", {})
    detail = data.get("detail_metrics", {})
    if not isinstance(summary, dict) or not isinstance(detail, dict):
        return ["L2: 缺少有效的 summary_metrics 或 detail_metrics"]

    # 1. 扫描命令解析与公共根
    command = summary.get("command", "")
    if "-l clike" not in command:
        errors.append("L2: command 必须包含 '-l clike'")

    fp_matches = re.findall(r"-fp\s+([^\s]+)", command)
    if len(fp_matches) != 1:
        errors.append(f"L2: command 必须恰有一个 -fp 参数，实测匹配到 {len(fp_matches)} 个")
        scan_paths: list[str] = []
    else:
        raw_fp = fp_matches[0]
        scan_paths = [p for p in raw_fp.split(",") if p]
        for p in scan_paths:
            if not p.startswith("/") or ".." in p or "//" in p:
                errors.append(f"L2: -fp 路径不是规范绝对路径: {p}")

    common_root = compute_common_root(scan_paths) if scan_paths else "/"

    # 2. method_metrics 尾部最大值对象校验
    method_metrics = detail.get("method_metrics", [])
    if not isinstance(method_metrics, list) or len(method_metrics) == 0:
        errors.append("L2: method_metrics 必须非空（至少包含 1 个末尾最大值对象）")
        methods: list[dict[str, Any]] = []
        tail_obj: dict[str, Any] | None = None
    else:
        tail_obj = method_metrics[-1]
        methods = method_metrics[:-1]

        if not isinstance(tail_obj, dict) or "maximum_cyclomatic_complexity" not in tail_obj:
            errors.append("L2: method_metrics 的最后一项必须是最大值对象")
        for idx, m in enumerate(methods):
            if isinstance(m, dict) and "maximum_cyclomatic_complexity" in m:
                errors.append(f"L2: 普通函数列表中发现非末尾的最大值对象（索引 {idx}）")

    # 3. 文件列表与引用完整性
    file_sizes = detail.get("file_sizes", {})
    if not isinstance(file_sizes, dict):
        errors.append("L2: file_sizes 必须是对象")
        file_sizes = {}

    all_file_paths = set(file_sizes.keys())

    # 检查明细路径必须位于 scan_paths 之下
    for path in all_file_paths:
        if scan_paths and not any(is_subpath(sp, path) for sp in scan_paths):
            errors.append(f"L2: 文件路径不在 -fp 扫描范围内: {path}")

    # 检查 file_sizes 三元组约束
    for path, sz in file_sizes.items():
        if not isinstance(sz, list) or len(sz) != 3:
            errors.append(f"L2: file_sizes[{path}] 不是三元数组")
            continue
        nbnc_loc, raw_line, d_f = sz
        if raw_line < 1:
            errors.append(f"L2: file_sizes[{path}] raw_line ({raw_line}) 必须 >= 1")
        if not (0 <= d_f <= nbnc_loc <= raw_line):
            errors.append(
                f"L2: file_sizes[{path}] 违反 0 <= code_duplication ({d_f}) <= nbnc_loc ({nbnc_loc}) <= raw_line ({raw_line})"
            )

    # 函数行号与引用约束
    actual_max_cc = 0
    actual_max_nbnc = 0
    method_nbnc_sum_per_file: dict[str, int] = {}

    for idx, m in enumerate(methods):
        if not isinstance(m, dict):
            continue
        fname = m.get("file_name", "")
        if fname not in all_file_paths:
            errors.append(f"L2: 函数 (索引 {idx}) 引用不存在的文件: {fname}")
        else:
            raw_line = file_sizes[fname][1]
            s_line = m.get("start_line", 0)
            e_line = m.get("end_line", 0)
            nbnc = m.get("nbnc_loc", 0)
            if not (1 <= s_line <= e_line <= raw_line):
                errors.append(
                    f"L2: 函数 '{m.get('method_name')}' 行号范围非法 (1 <= {s_line} <= {e_line} <= {raw_line})"
                )
            method_nbnc_sum_per_file[fname] = method_nbnc_sum_per_file.get(fname, 0) + nbnc

        cc = m.get("cyclomatic_complexity", 0)
        actual_max_cc = max(actual_max_cc, cc)
        actual_max_nbnc = max(actual_max_nbnc, m.get("nbnc_loc", 0))

    for fname, m_sum in method_nbnc_sum_per_file.items():
        if fname in file_sizes and m_sum > file_sizes[fname][0]:
            errors.append(
                f"L2: 文件 {fname} 内所有函数 nbnc_loc 之和 ({m_sum}) 超过该文件非空非注释代码行 ({file_sizes[fname][0]})"
            )

    # 尾对象最大值三方一致性校验
    if tail_obj and isinstance(tail_obj, dict):
        tail_cc = tail_obj.get("maximum_cyclomatic_complexity", -1)
        tail_nbnc = tail_obj.get("maximum_nbnc_loc", -1)
        summary_max_cc = summary.get("maximum_cyclomatic_complexity", -2)

        if tail_cc != actual_max_cc:
            errors.append(
                f"L2: 尾对象 maximum_cyclomatic_complexity ({tail_cc}) 与实际最大值 ({actual_max_cc}) 不符"
            )
        if tail_cc != summary_max_cc:
            errors.append(
                f"L2: 尾对象最大圈复杂度 ({tail_cc}) 与 summary 值 ({summary_max_cc}) 不符"
            )
        if tail_nbnc != actual_max_nbnc:
            errors.append(
                f"L2: 尾对象 maximum_nbnc_loc ({tail_nbnc}) 与实际函数最大非空非注释代码行 ({actual_max_nbnc}) 不符"
            )

    # 4. 重复代码片段与整文件重复引用
    code_dup = detail.get("code_duplication", {})
    if isinstance(code_dup, dict):
        for gname, frags in code_dup.items():
            if not isinstance(frags, list) or len(frags) < 2:
                errors.append(f"L2: 重复组 '{gname}' 片段数少于 2")
                continue
            for f in frags:
                fname = f.get("file_name", "")
                if fname not in all_file_paths:
                    errors.append(f"L2: 重复组 '{gname}' 引用不存在的文件: {fname}")
                else:
                    raw_line = file_sizes[fname][1]
                    s_line = f.get("start_line", 0)
                    length = f.get("code_duplication", 0)
                    if not (1 <= s_line <= raw_line):
                        errors.append(f"L2: 重复片段起始行越界: {s_line} (raw_line: {raw_line})")
                    if length < 1:
                        errors.append(f"L2: 重复片段长度必须 >= 1: {length}")

    dup_files = detail.get("duplication_files", {})
    if isinstance(dup_files, dict):
        for gname, f_list in dup_files.items():
            if not isinstance(f_list, list) or len(f_list) < 2:
                errors.append(f"L2: 整文件重复组 '{gname}' 成员少于 2")
            if len(set(f_list)) != len(f_list):
                errors.append(f"L2: 整文件重复组 '{gname}' 存在重复成员路径")
            for fname in f_list:
                if fname not in all_file_paths:
                    errors.append(f"L2: 整文件重复组 '{gname}' 引用不存在的文件: {fname}")

    # 5. 危险函数与冗余代码引用及行号
    unsafe = detail.get("unsafe_functions", {})
    calc_unsafe_total = 0
    if isinstance(unsafe, dict):
        for fname, func_dict in unsafe.items():
            if fname not in all_file_paths:
                errors.append(f"L2: unsafe_functions 引用不存在的文件: {fname}")
                continue
            raw_line = file_sizes[fname][1]
            if isinstance(func_dict, dict):
                for fn, lines in func_dict.items():
                    if not isinstance(lines, list):
                        continue
                    if len(set(lines)) != len(lines):
                        errors.append(f"L2: 危险函数 {fname}:{fn} 行号数组未去重")
                    for ln in lines:
                        if not (1 <= ln <= raw_line):
                            errors.append(
                                f"L2: 危险函数 {fname}:{fn} 行号 {ln} 超出物理行 {raw_line}"
                            )
                    calc_unsafe_total += len(lines)

    redundant = detail.get("redundant_code", {})
    calc_redundant_total = 0
    if isinstance(redundant, dict):
        for fname, lines in redundant.items():
            if fname not in all_file_paths:
                errors.append(f"L2: redundant_code 引用不存在的文件: {fname}")
                continue
            raw_line = file_sizes[fname][1]
            if isinstance(lines, list):
                for ln in lines:
                    if not (1 <= ln <= raw_line):
                        errors.append(f"L2: 冗余代码 {fname} 行号 {ln} 超出物理行 {raw_line}")
                calc_redundant_total += len(lines)

    # 6. 超大目录与文件树复算
    # 从已统计源码文件恢复目录树（计至扫描公共根，包含公共根）
    tree_dirs: set[str] = set()
    dir_direct_files: dict[str, set[str]] = {}
    dir_direct_subdirs: dict[str, set[str]] = {}

    if all_file_paths:
        tree_dirs.add(common_root)
        dir_direct_files[common_root] = set()
        dir_direct_subdirs[common_root] = set()

        for fpath in all_file_paths:
            # 获取 fpath 所在的所有祖先目录，直到 common_root
            segs = get_path_segments(fpath)
            # 文件直属目录
            parent_segs = segs[:-1]
            parent_dir = "/" + "/".join(parent_segs) if parent_segs else "/"
            filename = segs[-1]

            # 沿祖先回溯直到 common_root
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

    # 计算直接子项数 = 直属文件数 + 直属含有源码文件的子目录数
    dir_direct_items: dict[str, int] = {}
    for d in tree_dirs:
        dir_direct_items[d] = len(dir_direct_files.get(d, set())) + len(
            dir_direct_subdirs.get(d, set())
        )

    thresholds = summary.get("huge_threshold", {})
    huge_folder_thresh = thresholds.get("huge_folder", 50)
    expected_huge_folders = {
        d: cnt for d, cnt in dir_direct_items.items() if cnt > huge_folder_thresh
    }

    huge_folders_in_json = detail.get("huge_folders", {})
    if huge_folders_in_json != expected_huge_folders:
        errors.append(
            f"L2: huge_folders 与文件树复算不一致. 期望 {expected_huge_folders}, 实际 {huge_folders_in_json}"
        )

    # 7. 33 项 Summary 指标精确复算
    def check_int(name: str, expected: int) -> None:
        actual = summary.get(name)
        if actual != expected:
            errors.append(f"L2: 指标 {name} 复算不符: 期望 {expected}, 实际 {actual}")

    def check_float(name: str, expected: float) -> None:
        actual = summary.get(name)
        if actual is None:
            errors.append(f"L2: 指标 {name} 缺失")
            return
        exp_r = round_half_up(expected)
        act_r = round_half_up(actual)
        if abs(exp_r - act_r) > 1e-6:
            errors.append(f"L2: 指标 {name} 复算不符: 期望 {exp_r}, 实际 {act_r}")

    # 分组统计集合
    H_files = [p for p in all_file_paths if is_header_file(p)]
    S_files = [p for p in all_file_paths if is_source_file(p)]

    # 1. code_size
    calc_code_size = sum(sz[0] for sz in file_sizes.values())
    check_int("code_size", calc_code_size)

    # 2. raw_lines
    calc_raw_lines = sum(sz[1] for sz in file_sizes.values())
    check_int("raw_lines", calc_raw_lines)

    # 3. methods_total
    calc_methods_total = len(methods)
    check_int("methods_total", calc_methods_total)

    # 4. cyclomatic_complexity_total
    calc_cc_total = sum(m.get("cyclomatic_complexity", 0) for m in methods)
    check_int("cyclomatic_complexity_total", calc_cc_total)

    # 5. cyclomatic_complexity_per_method
    check_float("cyclomatic_complexity_per_method", safe_div(calc_cc_total, calc_methods_total))

    # 6. maximum_cyclomatic_complexity
    check_int("maximum_cyclomatic_complexity", actual_max_cc)

    # 7. huge_cyclomatic_complexity_total
    cc_thresh = thresholds.get("huge_cyclomatic_complexity", 20)
    calc_huge_cc = sum(1 for m in methods if m.get("cyclomatic_complexity", 0) > cc_thresh)
    check_int("huge_cyclomatic_complexity_total", calc_huge_cc)

    # 8. huge_cyclomatic_complexity_ratio
    check_float(
        "huge_cyclomatic_complexity_ratio", safe_div(calc_huge_cc, calc_methods_total, 100.0)
    )

    # 9. method_lines
    calc_method_lines = sum(m.get("nbnc_loc", 0) for m in methods)
    check_int("method_lines", calc_method_lines)

    # 10. lines_per_method
    check_float("lines_per_method", safe_div(calc_method_lines, calc_methods_total))

    # 11. huge_method_total
    m_thresh = thresholds.get("huge_method", 50)
    calc_huge_m = sum(1 for m in methods if m.get("nbnc_loc", 0) > m_thresh)
    check_int("huge_method_total", calc_huge_m)

    # 12. huge_method_ratio
    check_float("huge_method_ratio", safe_div(calc_huge_m, calc_methods_total, 100.0))

    # 13. files_total
    calc_files_total = len(all_file_paths)
    check_int("files_total", calc_files_total)

    # 14. folders_total
    calc_folders_total = len(tree_dirs) if all_file_paths else 0
    check_int("folders_total", calc_folders_total)

    # 15. lines_per_file
    check_float("lines_per_file", safe_div(calc_code_size, calc_files_total))

    # 16. huge_headerfile_total
    h_thresh = thresholds.get("huge_headerfile", 500)
    calc_huge_h = sum(1 for p in H_files if file_sizes[p][0] > h_thresh)
    check_int("huge_headerfile_total", calc_huge_h)

    # 17. huge_headerfile_ratio (分母是 files_total)
    check_float("huge_headerfile_ratio", safe_div(calc_huge_h, calc_files_total, 100.0))

    # 18. huge_non_headerfile_total
    nh_thresh = thresholds.get("huge_non_headerfile", 2000)
    calc_huge_nh = sum(1 for p in S_files if file_sizes[p][0] > nh_thresh)
    check_int("huge_non_headerfile_total", calc_huge_nh)

    # 19. huge_non_headerfile_ratio (分母是 files_total)
    check_float("huge_non_headerfile_ratio", safe_div(calc_huge_nh, calc_files_total, 100.0))

    # 20. huge_folder_total
    calc_huge_folder = len(expected_huge_folders)
    check_int("huge_folder_total", calc_huge_folder)

    # 21. huge_folder_ratio (分母是 folders_total)
    check_float("huge_folder_ratio", safe_div(calc_huge_folder, calc_folders_total, 100.0))

    # 22. file_duplication_total (成员路径并集)
    all_dup_file_paths: set[str] = set()
    if isinstance(dup_files, dict):
        for fl in dup_files.values():
            if isinstance(fl, list):
                all_dup_file_paths.update(fl)
    calc_dup_files_total = len(all_dup_file_paths)
    check_int("file_duplication_total", calc_dup_files_total)

    # 23. file_duplication_ratio
    check_float("file_duplication_ratio", safe_div(calc_dup_files_total, calc_files_total, 100.0))

    # 24. non_hfile_duplication_total
    calc_non_h_dup_files = sum(1 for p in all_dup_file_paths if is_source_file(p))
    check_int("non_hfile_duplication_total", calc_non_h_dup_files)

    # 25. non_hfile_duplication_ratio (分母是 files_total)
    check_float(
        "non_hfile_duplication_ratio", safe_div(calc_non_h_dup_files, calc_files_total, 100.0)
    )

    # 26. code_duplication_total
    calc_code_dup_total = sum(sz[2] for sz in file_sizes.values())
    check_int("code_duplication_total", calc_code_dup_total)

    # 27. code_duplication_ratio (分母是 code_size)
    check_float("code_duplication_ratio", safe_div(calc_code_dup_total, calc_code_size, 100.0))

    # 28. non_hfile_code_duplication_total
    calc_non_h_code_dup = sum(file_sizes[p][2] for p in S_files)
    check_int("non_hfile_code_duplication_total", calc_non_h_code_dup)

    # 29. non_hfile_code_duplication_ratio (分母是 code_size，含 ×100)
    check_float(
        "non_hfile_code_duplication_ratio", safe_div(calc_non_h_code_dup, calc_code_size, 100.0)
    )

    # 30. unsafe_functions_total
    check_int("unsafe_functions_total", calc_unsafe_total)

    # 31. unsafe_functions_kloc
    check_float("unsafe_functions_kloc", safe_div(calc_unsafe_total, calc_code_size, 1000.0))

    # 32. redundant_code_total
    check_int("redundant_code_total", calc_redundant_total)

    # 33. redundant_code_kloc (code_size < 1000 时为 0)
    if calc_code_size < 1000:
        expected_red_kloc = 0.0
    else:
        expected_red_kloc = safe_div(calc_redundant_total, calc_code_size, 1000.0)
    check_float("redundant_code_kloc", expected_red_kloc)

    return errors


def validate_l3(
    report_data: dict[str, Any],
    internal_model: dict[str, Any],
    change_ledger: list[dict[str, Any]] | None = None,
) -> list[str]:
    """L3 校验：校验内部有效行覆盖并集与 code_duplication 一致性、整文件重复判定与变化台账."""
    errors: list[str] = []

    detail = report_data.get("detail_metrics", {})
    file_sizes = detail.get("file_sizes", {})
    file_models = internal_model.get("file_models", {})

    # 1. 验证每个文件的 file_sizes[path][2] 严格等于该文件所有重复片段有效覆盖并集的大小
    for path, sz in file_sizes.items():
        fm = file_models.get(path)
        if not fm:
            errors.append(f"L3: 内部模型缺少文件 {path}")
            continue
        valid_lines: set[int] = set(fm.get("valid_lines", []))
        dup_lines_union: set[int] = set(fm.get("dup_lines_union", []))
        if len(valid_lines) != sz[0]:
            errors.append(
                f"L3: 文件 {path} 内部有效行数 ({len(valid_lines)}) 与 file_sizes[0] ({sz[0]}) 不一致"
            )
        if len(dup_lines_union) != sz[2]:
            errors.append(
                f"L3: 文件 {path} 内部重复行覆盖并集大小 ({len(dup_lines_union)}) 与 file_sizes[2] ({sz[2]}) 不一致"
            )

    # 2. 验证 duplication_files 的成员必须满足 d_f == n_f
    dup_files = detail.get("duplication_files", {})
    for gname, fl in dup_files.items():
        for fpath in fl:
            if fpath in file_sizes:
                nbnc, _, dup = file_sizes[fpath]
                if nbnc != dup:
                    errors.append(
                        f"L3: 整文件重复成员 {fpath} (组 '{gname}') 违反 nbnc_loc ({nbnc}) == dup_lines ({dup})"
                    )

    # 3. 若提供变化台账，校验台账记录
    if change_ledger is not None:
        if not isinstance(change_ledger, list):
            errors.append("L3: 变化台账必须为列表")
        else:
            for item in change_ledger:
                if not isinstance(item, dict) or "target" not in item or "field" not in item:
                    errors.append(f"L3: 变化台账条目格式非法: {item}")

    return errors
