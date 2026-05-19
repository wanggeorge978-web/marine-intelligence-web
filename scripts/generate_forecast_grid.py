from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def wind_dir_name(deg: float) -> str:
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[round(deg / 45) % 8]


def tide_name(value: int) -> str:
    return ["ebb", "slack", "flood"][value % 3]


def build_cell(x: int, y: int, lng: float, lat: float) -> dict:
    offshore = clamp((-124.0 - lng) / 3.2, 0, 1)
    north = clamp((lat - 48.05) / 2.35, 0, 1)
    ridge = math.sin((lat - 48.0) * 4.2) + math.cos((lng + 126.2) * 3.1)
    phase = x * 0.45 + y * 0.31

    wind = clamp(5.5 + offshore * 8.8 + north * 1.8 + math.sin(phase) * 2.8, 2, 24)
    wind_deg = (285 + math.sin(phase * 0.7) * 38 + offshore * 28) % 360
    current = clamp(0.35 + offshore * 1.45 + abs(math.sin(phase * 0.85)) * 0.75, 0.2, 3.2)
    current_deg = (90 + ridge * 38 + offshore * 52) % 360
    wave = clamp(0.35 + offshore * 1.85 + max(0, wind - 8) * 0.08, 0.2, 3.8)
    swell = clamp(wave * 0.75 + 0.15, 0.2, 3.2)
    period = round(clamp(7 + offshore * 6 + math.cos(phase) * 1.4, 5, 15), 1)
    tide_height = round(math.sin(phase * 0.8) * 1.15 + north * 0.25, 2)
    sst = clamp(10.8 + offshore * 4.7 + north * 0.6 + math.sin(phase * 0.6) * 0.7, 9.5, 17.5)
    pressure = round(1012 + math.cos(phase * 0.5) * 5 - offshore * 2, 1)
    precip = round(clamp((1 - offshore) * 0.8 + max(0, math.sin(phase - 1.2)) * 1.4, 0, 4), 1)
    visibility = round(clamp(18 - precip * 2.2 - (1 - offshore) * 2, 4, 22), 1)
    salinity = round(clamp(30.5 + offshore * 2.2 - (1 - north) * 0.4, 28.5, 34.0), 1)

    score = int(clamp(86 - abs(current - 1.25) * 14 - max(0, wind - 12) * 1.8 - max(0, wave - 1.5) * 6 + offshore * 7, 28, 94))
    condition = "晴间云" if precip < 0.2 else "阵雨云带" if precip > 1 else "多云"
    clarity = "深蓝水" if sst > 14.6 and offshore > 0.55 else "蓝绿水" if offshore > 0.32 else "近岸混水"
    target = "长鳍金枪鱼 / 银鲑" if offshore > 0.68 and sst > 14 else "三文鱼 / 底鱼" if offshore > 0.35 else "蟹 / 鳕类 / 近岸鱼"

    timeline = []
    for i, hour in enumerate([6, 9, 12, 15, 18, 21]):
        t_phase = phase + i * 0.55
        t_wind = clamp(wind + (i - 1) * 0.9 + math.sin(t_phase) * 1.2, 2, 26)
        t_current = clamp(current + math.sin(t_phase * 0.8) * 0.28, 0.15, 3.3)
        t_wave = clamp(wave + max(0, i - 2) * 0.12 + math.cos(t_phase) * 0.08, 0.2, 4.0)
        t_tide_height = round(math.sin(t_phase * 0.8) * 1.2 + north * 0.25, 2)
        bite = int(clamp(score + math.sin(t_phase - 0.8) * 12 - max(0, t_wind - 14) * 2, 18, 96))
        timeline.append(
            {
                "time": f"{hour:02d}:00",
                "bite": bite,
                "windKts": round(t_wind, 1),
                "currentKts": round(t_current, 1),
                "waveM": round(t_wave, 1),
                "tideHeightM": t_tide_height,
            }
        )

    return {
        "id": f"grid-{x:02d}-{y:02d}",
        "gridX": x,
        "gridY": y,
        "name": f"点击海域 {lat:.2f}, {lng:.2f}",
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "area": "温哥华岛西岸网格预报",
        "updatedAt": "2026-05-19T16:30:00Z",
        "score": score,
        "weather": {
            "condition": condition,
            "airTempC": round(11.5 + north * 2 + offshore * 1.4, 1),
            "windKts": round(wind, 1),
            "windDir": wind_dir_name(wind_deg),
            "pressureTrend": "rising" if pressure > 1014 else "falling" if pressure < 1010 else "steady",
        },
        "water": {
            "currentKts": round(current, 1),
            "currentDirDeg": round(current_deg),
            "swellM": round(swell, 1),
            "swellPeriodS": period,
            "tide": tide_name(x + y),
            "sstC": round(sst, 1),
            "clarity": clarity,
        },
        "marine": {
            "waveM": round(wave, 1),
            "wavePeriodS": period,
            "swellDirDeg": round((270 + offshore * 30 + math.sin(phase) * 20) % 360),
            "tideHeightM": tide_height,
            "salinityPsu": salinity,
            "visibilityKm": visibility,
            "precipMm": precip,
            "pressureHpa": pressure,
        },
        "fish": {
            "target": target,
            "biteWindow": "06:00-09:00，15:00-18:00" if score >= 72 else "09:00-12:00 观察窗口",
            "tactic": "点击点位为网格采样结果：结合风、浪、流、潮位判断是否适合作业，再决定拖钓、漂钓或近岸计划。",
            "risk": "演示网格，不是官方预报。真实出海必须核对官方海况、潮汐、规则和船况。",
        },
        "timeline": timeline,
    }


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    lngs = [round(-127.25 + i * 0.16, 4) for i in range(22)]
    lats = [round(48.05 + i * 0.12, 4) for i in range(21)]
    cells = [build_cell(x, y, lng, lat) for y, lat in enumerate(lats) for x, lng in enumerate(lngs)]
    (DATA / "forecast-grid.json").write_text(json.dumps(cells, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["generatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest["build"] = "全区域网格演示 v2.0"
    manifest["coverage"] = "温哥华岛西岸 22 x 21 静态预报网格，可点击任意覆盖点附近海域"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
