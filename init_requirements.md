## 度量指标结果对比分析

### 目标

实现度量指标结果对比分析可视化, 提高定位引入恶化原因效率.

### 指标说明

公司自研了代码度量指标分析工具，扫描指标包括:
    - 非空非注释代码量
    - 平均文件代码行
    - 平均函数代码行
    - 平均圈复杂度
    - 代码重复率
    - 文件重复率
    - 危险函数
    - 冗余代码
    - 超大圈复杂度
    - 超大函数
    - 超大头文件
    - 超大源文件
    - 超大目录

工具扫描结果输出为 json 格式, 最外层包含 summary_metrics 和 detail_metrics 两个 key

- summary_metrics 中是整体的统计数值.
- detail_metrics 各这指标的详情数据.

### 对比数据说明现状

我们需要看护下游各代码库的度量指标恶化情况. 所以需要有一款度量报告的对比工具.

我已经使用 Python 已经实现了一个报告的解析和对比的小工具. 可以生成 summary_metrics 和 detail_metrics 中各个详情信息的对比变化详情.

对比主要使用 pandas 的 merge 函数实现, 对比工具输出的是下面几个 excel 表格:

1. cmp_summary: 统计统计指标的变化量, 包含列: metrics_name, summary_cur, summary_baseline, delta
2. cmp_file_sizes: 每个文件非空非注释代码行的变化量, 包含列: file_name(文件路径), nbnc_loc_cur, nbnc_loc_baseline, delta. nbnc_loc_cur 或 nbnc_loc_baseline 为空表示当前或者基线中不包含该文件
3. cmp_code_duplication: 每个文件统计出的重复码行的变化量(重复代码是只整个扫描范围内的重复代码片段的行数, 判定重复代码不限于本文件), 包含列: file_name(文件路径), dupliaction_line_cur, dupliaction_line_baseline, delta. dupliaction_line_cur 或 dupliaction_line_baseline 为空表示当前或者基线中该文件中没有重复代码片段. 只有这个对比文件只能粗略的看出是哪些文件引入了重复代码, 定位具体的代码片段需要结合当前和基线数据的 detail_metrics.code_duplications 详情信息, 其中将互相重复的代码片段标记为一组。转化为表格形式, 包含列 file_name, duplication_group, duplication_code(重复代码片段长度), start_line, end_line
4. cmp_duplication_files, 对比是否有新增重复文件, 包含列 file_name, value_cur, value_basline, delta. 说明: delta 取值只可能是 0, 1, -1; 0表示没有变化, 1 表示新增, -1 表示减少了. value_cur 和 value_baseline 的取值只可能为 1 或者空值.
5. cmp_method_nbnc, 对比每个函数的非空注释代码行数, 包含列: file_name, method_name, nbnc_loc_cur, nbnc_loc_baseline, delta
6. cmp_method_cc, 对比每个函数的圈复杂度, 包含列: file_name, method_name, cc_cur, cc_baseline, delta
7. cmp_unsafe_functions, 对比危险函数, 包含列: file_name, method_name, value_cur, value_baseline, delta. 说明: delta 取值只可能是 0, 1, -1; 0表示没有变化, 1 表示新增, -1 表示减少了. value_cur 和 value_baseline 的取值只可能为 1 或者空值.
8. cmp_redundant_codes, 对比冗余代码, 包含列: file_name, start_line, value_cur, value_baseline, delta. 说明: delta 取值只可能是 0, 1, -1; 0表示没有变化, 1 表示新增, -1 表示减少了. value_cur 和 value_baseline 的取值只可能为 1 或者空值.
9. cmp_huge_headerfile, 对比超大头文件, 包含列: file_name, value_cur, value_baseline, delta. 说明：value_cur, value_baseline, 表示文件的非空非注释代码行
10. cmp_huge_non_headerfile, 对比超大源文件文件, 包含列: file_name, value_cur, value_baseline, delta. 说明：value_cur, value_baseline, 表示文件的非空非注释代码行
11. cmp_huge_method, 对比超大函数, 包含列: file_name, method_name, value_cur, value_baseline, delta. 说明：value_cur, value_baseline, 表示函数的非空非注释代码行
12. cmp_huge_cc, 对比超大圈复杂度函数, 包含列: file_name, method_name, value_cur, value_baseline, delta. 说明：value_cur, value_baseline, 表示函数的圈复杂度
13. cmp_huge_folder, 对比超大目录, 包含列: file_name, value_cur, value_baseline, delta. 说明：value_cur, value_baseline, 表示目录下一级(不递归)的文件和子目录的个数

整体来看我现在生成的对比数据的类型分为数值型和计数型两种

数值型: cmp_file_sizes, cmp_code_duplication, cmp_method_nbnc, cmp_method_cc, cmp_huge_headerfile, cmp_huge_non_headerfile, cmp_huge_method, cmp_huge_cc, cmp_huge_folder
计数型: cmp_duplication_files, cmp_unsafe_functions, cmp_redundant_codes

两种类型都遵循 delta = cur - baseline

对比数据格式现状如此, 但不是固定死的, 可以根据需要调整.

### 当前痛点

- 对比数据用多个 excel 表格承载, 不直观, 用户需要学习和了解表格格式才能使用
- 用户为了分析定位引入增长的原因可能需要进行手动筛选和排序
- 部分数据需要结合表格手动分析, 操作复杂
    - 重复代码对比, 需要先通过 cmp_code_dupliaction 中找到重复代码行数增长的文件路径, 在用文件路径在重复代码详情数据中搜索, 找到对应的重复代码片段分组, 通过分组编号才能找到互相重复的代码片段的位置信息
    - 超大目录, cmp_huge_folder 之后目录下文件和子目录数量, 缺少详细列表. 需要结合 detail_metrics.file_sizes 获取目录下一级的文件列表
- cmp_file_size/cmp_code_dupliaction/cmp_method_nbnc/cmp_method_cc 只有明细数据, 缺少动态分层聚合统计
- 函数相关的当前都是使用文件路径 + 函数名作为 merge 的 key, 如果同一个文件中包含有不止一个同名函数, 对比文件中会显示全排列


### 数据规模 + 性能要求

- 总代码量: 25 * 1000 * 1000
- 文件总数: 100 * 1000
- 总函数舒: 1000 * 1000
