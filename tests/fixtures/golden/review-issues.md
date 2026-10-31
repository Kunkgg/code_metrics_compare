## golden data 数据审核

### 通用

3. `_kloc` 指标也都是保留小数点后两位, 所有浮点数都是保留小数点后两位
4. 需要 scheme 和数据生成约束的数据不需要放在 golden_data 中, golden_data 应该只用来验证对比业务逻辑

### comments-only

OK

### empty

OK

### folder-coverage

#### current.json

```
    "huge_folders": {
      "/golden/project/src": 5
    }
```

但是file_sizes 列表中 src 目录下只有 3 个文件, 不一致

另外, 我没有看懂这组数据主要想验证什么, 解释一下


### density-999-1000

解释这组数据的作用，没看懂，是要为了验证啥？

### density-1000-1001

解释这组数据的作用，没看懂，是要为了验证啥？

### file-duplication

解释 content 子目录的作用

### missing-value

cmetrics 工具输出不存在这种情况, 这组数据没有必要

### strict-thresholds

解释这组数据的作用，没看懂，是要为了验证啥？

### threshold-change

更正阈值变化处理方式： 仍需要对超大指标详情做对比, 但需要提示用户阈值变化.

### summary-conflict

cmetrics 工具输出不存在这种情况, 这组数据没有必要

### mixed-changes

希望数据再丰富一些, 可以体现各个指标的 新增/退出/增长/减少/不变. 可以按指标进行数据集拆分, 不要都放在一个 mixed-changes 里面
