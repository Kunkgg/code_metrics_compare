"""原型工具共用的进程峰值内存统计。"""

import sys


def peak_rss_mib() -> float:
    """返回 OS 记录的进程峰值 MiB；Windows 使用峰值工作集。"""
    if sys.platform == "win32":
        import psutil

        return psutil.Process().memory_info().peak_wset / 1024**2

    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024**2 if sys.platform == "darwin" else 1024)
