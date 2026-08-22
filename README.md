# Chamber Recall

An offline patient-history system for a private doctor's chamber.
One laptop, one encrypted database file, no internet at any point.

**Status: milestone 1 of 13.** Foundations only. There is no register, no
intake, no Recall Card and no prescription printing yet.

---

## What exists today

- An encrypted SQLite database (SQLCipher) that will not open without the
  doctor's password or his printed recovery key.
- The complete database schema for the whole project, in one readable file:
  [`src/main/db/schema.sql`](src/main/db/schema.sql).
- The three roles, and the rules about who may enter what.
- An audit log the database itself refuses to let anything edit or delete.
- Usage logging, which the pilot report will be built from.
- A practice database: 312 invented patients, 1,451 visits across two
  chambers over four years, with vitals series, outstanding investigations
  and deliberate duplicates.
- 78 tests covering key custody, the database layer, and the practice data.

## Running it

```bash
npm install
npm test                # 78 tests
npm run seed            # build the practice database in ./data/demo
npm start               # open the application
```

To open the application against the practice database:

```bash
CHAMBER_RECALL_DATA_DIR=./data/demo npm start
# password: practice
```

Without `CHAMBER_RECALL_DATA_DIR` the application uses its own folder and
offers to set up a fresh installation.

## Where things live

```
src/main/db/schema.sql    the whole data model, commented. Read this first.
src/main/keystore/        where the encryption key lives, and why
src/main/db/              opening, migrating, audit log, usage log
src/main/seed/            the practice data generator
src/main/index.ts         the application process
src/renderer/             the screens
tests/                    what is proven, in plain language
docs/DECISIONS.md         every judgement call made, and the open questions
```

## Two things worth knowing before you touch anything

**The database refuses to be rewritten.** Audit rows cannot be updated or
deleted, and no clinical row can be hard deleted, because of triggers in
`schema.sql`. This is enforced by the database and not by convention, so a
future mistake cannot quietly undo it. To remove something, set its
`deleted_at`.

**Practice data and real patients can never share a file.** Every database
is marked `demo` or `live` at the moment it is created. The seed script
refuses to write into a `live` database, and refuses to write into any
database that already has patients in it.

## Backups

There is no backup feature yet; it arrives at milestone 12. Until then,
copying the whole data folder is the backup. The folder holds the database
and the key file, and both are needed.
