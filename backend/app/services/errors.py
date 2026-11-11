class TaskAbort(Exception):
    """不值得自动重试的失败（对象已删除、缺前置步骤、配置不对），任务直接标记失败。"""
