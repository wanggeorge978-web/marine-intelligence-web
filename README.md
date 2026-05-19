# 海钓智能助手 Web MVP

React + Vite + TypeScript 网页版 MVP，用来展示钓鱼天气、水流、潮汐、
鱼情评分、区域规则、预警、蓝水/SST、长鳍金枪鱼搜索、钓点保存、航线快检和
出海简报。

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## 数据

项目按 GitHub Pages 免费静态托管设计，前端只读取 `public/data` 里的静态
JSON / GeoJSON。`scripts/update_data.py` 是后续接入官方数据源的入口。

Current files:

- `public/data/manifest.json`
- `public/data/forecasts.json`
- `public/data/rules.json`
- `public/data/warnings.geojson`
- `public/data/pfma.geojson`
- `public/data/albacore.geojson`
- `public/data/bluewater.json`

当前数据均为演示样例，不可用于导航、法规判断或真实出海决策。出发前必须核对
官方规则、公告和海上天气。
