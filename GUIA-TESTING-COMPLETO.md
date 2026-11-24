# Guía de testing completo (BDRamas / TDD tracking)

Para probar la entrega del sprint, sigue las secciones 1 y 2 y continúa en [Prueba de principio a fin con la API](#prueba-de-principio-a-fin-con-la-api). Las secciones 3 a 5 explican cómo inspeccionar SQLite y los hooks por separado.

> Entorno de referencia: Windows + PowerShell. Ajusta rutas/comandos si usas otro shell.

---

## 1. Prerrequisitos

Abre PowerShell en una carpeta de trabajo. Comprueba que tienes Git, Node.js 20 y npm.

```powershell
git --version
node --version
npm --version
```

Clona la rama de Caleb que contiene la entrega. Si ya tienes este repositorio clonado, entra en su carpeta y usa `git switch feat/registrar-actividad-tdd-en-push` en lugar de volver a clonarlo.

```powershell
git clone --branch feat/registrar-actividad-tdd-en-push https://github.com/CalebBav234/BDRamas-4.0.4.git
cd BDRamas-4.0.4
git branch --show-current
npm ci
git config --get core.hooksPath
```

La rama debe ser `feat/registrar-actividad-tdd-en-push`. La instalación activa Husky y el último comando debe mostrar `.husky/_`.

## 2. Ejecutar las pruebas y compilar

1. **Ejecuta la suite habitual y genera la compilación.**

   ```powershell
   npm test
   npm run build
   ```

   En la entrega del sprint pasan 27 pruebas (1 de la aplicación, 17 del ejecutor TDD y 9 de ramas y envío). Parcel genera `dist/index.html`.

2. **Para repetir únicamente la prueba de ramas y del POST**, ejecuta el siguiente comando. La suite crea su propio servidor HTTP y remoto Git temporales. Cubre el primer push, ambos tipos de merge y el reintento tras un HTTP 503. Puedes correrla incluso con la API del equipo apagada.

   ```powershell
   npm run test:branches
   ```

3. **(Opcional) Cobertura de app**
   ```powershell
   npm run test:coverage
   ```
   - Esperado: reporte generado en `coverage/` para el alcance configurado en `jest.config.js`.

---

## 3. Verificar BD local SQLite (esquema e inicialización)

1. **Inicializar esquema local**
   ```powershell
   npm run db:init:local
   ```
   - Esperado: mensaje indicando esquema SQLite inicializado en `.tddlab\tddlab.db`.

2. **Comprobar que el archivo existe**
   ```powershell
   Test-Path .\.tddlab\tddlab.db
   Get-ChildItem .\.tddlab -ErrorAction SilentlyContinue
   ```
   - Esperado: `True` y el archivo `tddlab.db` presente. En esta rama el archivo predeterminado ya está versionado. La prueba de la API usa un archivo separado.

3. **Inspeccionar tablas y datos (sin `sqlite3` CLI, usando Node + better-sqlite3)**
   ```powershell
   node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT name FROM pragma_table_list ORDER BY name').all());db.close()"
   ```
   - Esperado: tablas como `tdd_branch`, `tdd_commit`, `tdd_merge`, `tdd_execution`, `tdd_schema_migration`.

4. **Idempotencia**
   - Ejecuta de nuevo `npm run db:init:local`.
   - Esperado: finaliza sin error y sin duplicar/corromper el esquema.

---

## 4. Verificar hooks y tracking local (pre-commit / post-commit / checkout)

Los hooks escriben en la **BD local SQLite** (salvo que se omitan). Para no interferir con tu trabajo, usa una rama de prueba.

1. **Crear rama de prueba**
   ```powershell
   git checkout -b test/db-hooks-verification
   ```

2. **Probar pre-commit (registro antes del commit)**
   - Crea un cambio trivial (no lo subas):
     ```powershell
     "test $(Get-Date -Format o)" | Out-File -Encoding utf8 .tddlab-hook-test.tmp
     git add .tddlab-hook-test.tmp
     git commit -m "test: verificar pre-commit db"
     ```
   - Esperado: el commit se crea (o el hook no lo bloquea). El hook `pre-commit` ejecuta `script/pre-commit-tracker.js` y registra contexto/rama en SQLite.

3. **Verificar registro en SQLite tras commit**
   ```powershell
   node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log('branches',db.prepare('SELECT * FROM tdd_branch').all());console.log('commits',db.prepare('SELECT sha,branch,message FROM tdd_commit ORDER BY rowid DESC LIMIT 5').all());db.close()"
   ```
   - Esperado: aparece la rama `test/db-hooks-verification` y el commit reciente con su SHA real y mensaje.

4. **Probar post-checkout (registro de rama al cambiar)**
   ```powershell
   git checkout -
   git checkout test/db-hooks-verification
   ```
   - Repite la consulta del paso 3.
   - Esperado: la rama sigue/queda registrada en `tdd_branch`.

5. **Omitir tracking (comportamiento de hooks)**
   - En PowerShell (solo sesión actual):
     ```powershell
     $env:HUSKY_SKIP_TRACK = "1"
     git commit --allow-empty -m "test: skip tracking"
     Remove-Item Env:HUSKY_SKIP_TRACK
     ```
   - Esperado: el commit se realiza; no debe fallar por BD. (Úsalo solo para pruebas controladas).

6. **Limpieza del commit/archivo de prueba (opcional, si no lo necesitas)**
   - Elimina el archivo temporal y ajusta la rama según tu flujo (evita reescribir historial compartido). Puedes borrar la rama de prueba al finalizar:
     ```powershell
     git checkout <tu-rama-original>
     git branch -D test/db-hooks-verification
     ```

---

## 5. Verificar registro de merges (incluye fast-forward)

Usa un repo/ramas locales de prueba.

1. **Preparar base**
   ```powershell
   git checkout -b test/merge-local-base
   echo "base" > merge-test.txt; git add merge-test.txt; git commit -m "test: base merge"
   ```

2. **Merge no fast-forward**
   ```powershell
   git checkout -b test/merge-feature
   echo "feature" >> merge-test.txt; git add merge-test.txt; git commit -m "test: feature change"
   git checkout test/merge-local-base
   git commit --allow-empty -m "test: mainline change"
   git merge --no-ff test/merge-feature -m "test: merge no-ff"
   ```
   - Consulta:
     ```powershell
     node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT source_branch,target_branch,source_commit_sha,merge_commit_sha,is_fast_forward,merged_at FROM tdd_merge ORDER BY id DESC LIMIT 5').all());db.close()"
     ```
   - Esperado: un registro con `is_fast_forward = 0` (o equivalente) y ramas/SHAs coherentes.

3. **Merge fast-forward**
   ```powershell
   git checkout -b test/ff-feature test/merge-local-base
   echo "ff" > ff.txt; git add ff.txt; git commit -m "test: ff feature"
   git checkout test/merge-local-base
   git merge test/ff-feature
   ```
   - Repite la consulta de `tdd_merge`.
   - Esperado: registro con `is_fast_forward = 1` (según detección por reflog/ORIG_HEAD) para el merge fast-forward.

4. **Limpieza**: vuelve a tu rama de trabajo y elimina ramas/archivos temporales si corresponde.

---

## 6. Verificar la sincronización pre-push

### Prueba de principio a fin con la API

Usa una misma ventana de PowerShell para los pasos 1 a 5. El último paso publica una rama de prueba en el remoto `origin` y necesita permiso de escritura. Para comprobar el flujo solo en local, basta con la sección 2.

1. **Selecciona el endpoint y una base SQLite de prueba.** El backend de TDDLab debe estar en ejecución en la máquina de la URL, con PostgreSQL configurado. Si el equipo te da una dirección distinta, sustituye la URL en la primera línea.

   ```powershell
   $env:TDD_BRANCHES_URL = "http://localhost:3000/api/TDDCycles/branches/branches"
   $env:SQLITE_DB_PATH = ".tddlab/prueba-api.db"
   npm run db:init:local
   ```

2. **Prepara una rama de destino y otra de trabajo.** El sufijo evita reutilizar ramas de demostraciones anteriores.

   ```powershell
   $id = Get-Date -Format "yyyyMMdd-HHmmss"
   $destino = "test/registro-api-$id"
   $origen = "test/cambio-api-$id"
   git switch -c $destino feat/registrar-actividad-tdd-en-push
   git switch -c $origen
   git commit --allow-empty -m "test: comprobar el registro de una ejecución"
   $sha = git rev-parse HEAD
   ```

3. **Ejecuta Jest en ese commit y consulta su fila en SQLite.** El SHA impreso debe coincidir con `$sha`. Con el sumador de esta entrega se espera 1 prueba aprobada y 0 fallidas.

   ```powershell
   npm run test:app
   $sha
   node -e "const db=require('better-sqlite3')(process.env.SQLITE_DB_PATH,{readonly:true}); console.table(db.prepare('SELECT commit_sha, tests_total, tests_passed, tests_failed FROM tdd_execution WHERE commit_sha = ?').all(process.argv[1])); db.close()" $sha
   ```

4. **Crea el merge y verifica el registro local.** Deben aparecer las dos ramas de este ejercicio y `is_fast_forward` debe valer `0`.

   ```powershell
   git switch $destino
   git merge --no-ff $origen -m "test: integrar la ejecución de prueba"
   node -e "const db=require('better-sqlite3')(process.env.SQLITE_DB_PATH,{readonly:true}); console.table(db.prepare('SELECT source_branch, target_branch, merge_commit_sha, is_fast_forward FROM tdd_merge WHERE merge_commit_sha = ?').all(process.argv[1])); db.close()" (git rev-parse HEAD)
   ```

5. **Publica y comprueba la respuesta.**

   ```powershell
   git push -u origin $destino
   git ls-remote --heads origin "refs/heads/$destino"
   git rev-parse HEAD
   ```

   El hook envía un único `POST` JSON con `repository`, `branches`, `commits` y `merges`. Dentro de cada commit van `commitedAt` y `tddExecutions`. Para este ejemplo la API debería confirmar **2 ramas, 2 commits, 1 merge y 1 ejecución**. Busca la línea `[pre-push] API:` y comprueba que el SHA remoto coincide con `HEAD`. Para verificar la persistencia, consulta la base del backend con el SHA que guardaste en el paso 2.

   ```sql
   SELECT c.sha, e.tests_total, e.tests_passed, e.tests_failed
   FROM tdd_commit AS c
   JOIN tdd_execution AS e ON e.commit_sha = c.sha
   WHERE c.sha = '<pega aquí el SHA del paso 2>';
   ```

**Reintento del push.** Si se rechaza la conexión, revisa la URL y que el backend esté escuchando. Con HTTP 500, revisa el error en la consola del servidor. En la revisión del 24/11/2026, el backend solicitaba `tdd_repository.created_at` y `tdd_commit.branchi_id`, incompatibles con el esquema publicado. Las claves de rama de `tdd_merge` también tenían tipos incompatibles. Una vez corregida la causa, repite `git push -u origin $destino` desde la misma terminal. La ejecución original sigue en SQLite. [Consultas del backend revisado](https://github.com/UCB-TallerSoft-2026-2/TDDLab/blob/ef9ad6f18c6a5954d82b912465c53ec76d69a7ab/server/src/modules/TDDCycles/Repositories/DBBranchRepository.ts) · [Esquema revisado](https://github.com/UCB-TallerSoft-2026-2/TDDLab/blob/ef9ad6f18c6a5954d82b912465c53ec76d69a7ab/ModeloDatos/database/schema.sql)

Al terminar, vuelve a la rama de la entrega con `git switch feat/registrar-actividad-tdd-en-push`. Cerrar la ventana de PowerShell descarta las variables de esta sesión.

### Sincronización directa con PostgreSQL/Neon

Para probar este modo alternativo, abre otra sesión y configura solo `DATABASE_URL` con la conexión de tu base PostgreSQL de pruebas. Si usas `.env`, deja `TDD_BRANCHES_URL` sin definir. El comando `npm run db:sync` utiliza la sincronización directa con PostgreSQL.

El hook `.husky/pre-push` ejecuta `script/pre-push-sync.js`, que:
- lee refs desde stdin del push,
- calcula commits de la rama a subir,
- extrae de SQLite solo datos relevantes (commits/rama/ejecuciones/merges relacionados),
- valida `DATABASE_URL` y sincroniza al remoto,
- **aborta el push** si falla la sincronización (a menos que se omita explícitamente).

### 6.1 Verificación de seguridad de configuración (sin exponer secretos)
```powershell
node -e "import('./script/db-security.js').then(m=>{try{console.log(m.validateDatabaseUrl(process.env.DATABASE_URL,{requireSsl:false}))}catch(e){console.error('invalid:',e.message)}})"
```
- Requiere que `DATABASE_URL` esté cargada en el entorno (p. ej. dotenv lo carga en scripts; para esta prueba rápida puedes ejecutar desde Node con `-r dotenv/config` o usar los scripts npm). Alternativa:
```powershell
node -r dotenv/config -e "import('./script/db-security.js').then(m=>{try{console.log(m.validateDatabaseUrl(process.env.DATABASE_URL))}catch(e){console.error('invalid:',e.message)}})"
```
- Esperado: objeto con `host/database/sslmode/secure/masked` sin mostrar contraseña en claro. Si es inválida o insegura según flags, muestra error.

### 6.2 Inicializar esquema remoto (si aplica)
```powershell
npm run db:init:remote
```
- Esperado: esquema PostgreSQL remoto inicializado (requiere `DATABASE_URL` válida y accesible).

### 6.3 Prueba de sync (simulada por stdin)
`pre-push` recibe líneas `localRef localSha remoteRef remoteSha` por stdin. Puedes simular sin hacer push real:
```powershell
$head = git rev-parse HEAD
$branch = git rev-parse --abbrev-ref HEAD
"$("refs/heads/$branch") $head $("refs/remotes/origin/$branch") 0000000000000000000000000000000000000000" | node ./script/pre-push-sync.js
```
- Ajusta `remoteSha` a un SHA real remoto si quieres sincronizar solo un rango incremental.
- Esperado: mensaje `[pre-push-sync] Sincronizado...` o “sin datos nuevos”. Con `DATABASE_URL` inválida/inaccesible: error enmascarado y exit code != 0 (comportamiento deseado antes de un push real).

### 6.4 Prueba de push real (controlada)
- Haz push de una rama de prueba a un remoto de prueba:
  ```powershell
  git push -u origin test/db-hooks-verification
  ```
- Esperado: si hay datos y credenciales válidas, sincroniza y luego continúa el push; si falla, el push se aborta con mensaje de sincronización.

### 6.5 Omitir sync (solo pruebas controladas)
```powershell
$env:SKIP_DB_SYNC = "1"; git push; Remove-Item Env:SKIP_DB_SYNC
```
- Esperado: omite la sincronización de BD. **No recomendado** en flujo normal (pierde trazabilidad remota).

---

## 7. Verificar scripts remotos/Neon existentes (opcionales según entorno)

1. **Conectividad y tablas remotas**
   ```powershell
   npm run test:neon
   ```
   - Requiere `DATABASE_URL`. Esperado: conexión exitosa y listado de tablas TDD disponibles.

2. **Integración real Neon (opt-in)**
   ```powershell
   $env:RUN_NEON_INTEGRATION = "1"; npm run test:neon:integration; Remove-Item Env:RUN_NEON_INTEGRATION
   ```
   - Esperado: pruebas de inserción/rollback y limpieza (según implementación del script).

3. **Flujo de app que registra ejecución remota**
   ```powershell
   npm run test:app
   ```
   - Requiere `DATABASE_URL` y repo Git (según `script/tddScript.js`/store remoto). Esperado: ejecuta Jest, genera/lee reporte y registra ejecución en la BD remota configurada.

---

## 8. Verificaciones de seguridad (checklist)

- [ ] `.env` no está versionado (`git status` limpio respecto a `.env`).
- [ ] `.env.example` no contiene secretos reales.
- [ ] `DATABASE_URL` usa `sslmode=require` (o SSL equivalente) fuera de local; `REQUIRE_DB_SSL=1` en entornos estrictos.
- [ ] Errores de BD no exponen credenciales (mensajes enmascarados por `db-security`).
- [ ] La base de la demostración `.tddlab/prueba-api.db` queda fuera del commit.
- [ ] Hooks pueden omitirse solo con `HUSKY_SKIP_TRACK=1` / `SKIP_DB_SYNC=1` de forma consciente.

---

## 9. Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| Solo quiero repetir las pruebas del ejecutor TDD | `npm test` incluye tres grupos de pruebas | Ejecuta `npm run test:runner` |
| Error de parseo JSON/BOM en `package.json` | Archivo con BOM | Re-guardar `package.json` como UTF-8 sin BOM |
| `DATABASE_URL no está configurada` | Falta `.env` o variable | Crear `.env` desde `.env.example` y definir `DATABASE_URL` |
| `DATABASE_URL debe usar SSL...` | `sslmode` ausente/disable con `REQUIRE_DB_SSL=1` | Añadir `sslmode=require` o ajustar flags solo en local controlado |
| Pre-push aborta | Sync remoto falla o URL inválida | Revisar conectividad/credenciales/SSL; usar `SKIP_DB_SYNC=1` solo si aceptas no sincronizar |
| No aparecen datos en SQLite | Hook omitido o commit fuera de repo | Verificar `HUSKY_SKIP_TRACK`, estar en repo Git y repetir operación |
| Faltan datos en el backend HTTP | La API devolvió un error o el push ya estaba al día | Comprueba la URL, busca la línea `[pre-push] API:` y contrasta los contadores con el SHA en la base del backend |
| `better-sqlite3` falla al instalar/cargar | Binario nativo incompatible | Reinstalar dependencias (`npm ci`/`npm install`) con toolchain compatible en Windows |

---

## 10. Resultado esperado (resumen)

- `npm test` ejecuta la aplicación, el ejecutor TDD y las pruebas de ramas y envío.
- `npm run db:init:local`: crea/actualiza `.tddlab/tddlab.db` con el esquema requerido.
- Commits/checkouts/merges (incl. fast-forward) en ramas de prueba: generan/actualizan registros en SQLite (`tdd_branch`, `tdd_commit`, `tdd_merge`).
- Pre-push: con `DATABASE_URL` válida, sincroniza solo los datos necesarios de la rama a PostgreSQL y permite el push; con fallo, bloquea el push.
- El archivo `.env` y la base SQLite de la demostración quedan fuera del commit.
