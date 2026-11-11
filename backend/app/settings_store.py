"""运行期配置的读写。默认值来自 config.DEFAULT_SETTINGS，数据库里存用户改过的值。"""
import copy

from sqlalchemy.orm import Session

from .config import DEFAULT_SETTINGS, SECRET_KEYS
from .models import Setting

MASK = "********"


def get_all(db: Session) -> dict:
    data = copy.deepcopy(DEFAULT_SETTINGS)
    for row in db.query(Setting).all():
        if isinstance(data.get(row.key), dict) and isinstance(row.value, dict):
            data[row.key].update(row.value)
        else:
            data[row.key] = row.value
    return data


def get(db: Session, key: str):
    return get_all(db).get(key)


def masked(data: dict) -> dict:
    """给前端看的版本：密钥只显示是否已填。"""
    out = copy.deepcopy(data)
    for section, field in SECRET_KEYS:
        if isinstance(out.get(section), dict) and out[section].get(field):
            out[section][field] = MASK
    return out


def update(db: Session, patch: dict) -> dict:
    current = get_all(db)
    for key, value in patch.items():
        if key not in DEFAULT_SETTINGS:
            continue
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            merged = dict(current[key])
            for f, v in value.items():
                # 前端回传掩码 = 没改，保留原值
                if (key, f) in SECRET_KEYS and v == MASK:
                    continue
                merged[f] = v
            value = merged
        row = db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    return get_all(db)
