# DOCX → EJS Template Builder (MVP)

Standalone MVP for CRM template configuration:

1. Permissioned user uploads a **DOCX** (author places `{{variable}}` markers)  
2. System converts to EJS (`{{x}}` → `<%= x %>`), keeps document HTML structure  
3. User maps each variable → allowlisted Model + field (from DB in `.env`)  
4. **Export EJS** writes the `.ejs` file (blocked until all variables are mapped)

Binding to `file_template` / `process_step` is **out of scope** for this slice (see `docs/ideas/docx-to-ejs-one-screen.md`).

This app does **not** modify `sunbrightvn_api` runtime. It can point at the **same MySQL** (local/staging only).

## Confirmed scope

| In MVP | Out of MVP |
|--------|------------|
| Upload DOCX → draft EJS | PDF → EJS |
| Map variables → Model/field (allowlist) | Pixel-perfect Word clone |
| Export `.ejs` when fully mapped | Publish to `FileTemplate` / process steps |
| API key auth (+ optional JWT hook) | Hand EJS editor / rename vars to `tenBienN` |

## Setup

```bash
cd mvp/pdf-ejs-template-builder
cp .env.example .env
# Fill MYSQL_* for LOCAL or STAGING only — never production
npm install
```

Run the draft table DDL once on that DB:

```bash
# using your local mysql client
mysql -h ... -u ... -p ... < sql/001_template_builder_draft.sql
```

Start:

```bash
npm run dev
```

Open `http://localhost:4050` — default API key: `dev-key-change-me`.

### Point EJS output at the main API views (optional)

In `.env`:

```env
EJS_OUTPUT_DIR=C:/Users/you/Documents/sunbrightvn_api/server/controllers/template/views/mvp_generated
PATH_TEMPLATE_PREFIX=/views/mvp_generated
```

Create the folder if missing. Main API must already resolve `path_template` under its template views root the same way existing templates do.

## API

All `/api/*` routes require header:

```http
X-Template-Builder-Key: <key from TEMPLATE_BUILDER_API_KEYS>
```

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/drafts/upload` | multipart `docx` + optional `name`, `description` |
| GET | `/api/drafts` | list drafts |
| GET | `/api/drafts/:id` | get draft |
| PATCH | `/api/drafts/:id` | update `variables_json` (mapping), etc. |
| POST | `/api/drafts/:id/export-ejs` | write `.ejs` if all variables mapped |
| GET | `/api/catalog/models` | allowlisted CRM models (+ table availability) |
| GET | `/api/catalog/models/:name/fields` | columns for a model |
| GET | `/health` | app + DB ping |

## Export behavior

- Requires every detected variable to have `model` + `field` in `variables_json`
- Writes `.ejs` under `EJS_OUTPUT_DIR` and sets draft status to `exported`
- Does **not** create/update `file_template` or `process_step_has_file_template` (later phase)

Model allowlist and table name mapping live in `src/config/modelAllowlist.js` (with alternate table name fallbacks).

## Safety

- Do not point `.env` at production.  
- This MVP uses a small write surface on shared tables; test on a copy of staging/local first.
