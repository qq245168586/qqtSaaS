# FastAPI Swagger 查看器

该工具只生成和展示文档，不替换现有 NestJS/TypeScript API。启动时扫描 `../server/src` 中的
`@Controller`、`@Get`、`@Post`、`@Put`、`@Patch`、`@Delete`，因此新增或删除控制器路由后重启即可同步。

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8010
```

- Swagger UI: <http://127.0.0.1:8010/docs>
- ReDoc: <http://127.0.0.1:8010/redoc>
- OpenAPI JSON: <http://127.0.0.1:8010/openapi.json>
- 扫描状态: <http://127.0.0.1:8010/meta>
