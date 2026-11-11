# Fixture syllabus for checkSyllabusOrder

## B2 · Fixture

### Unit 1: One

| # | id | title | unit | type | prerequisites | scope |
|---|---|---|---|---|---|---|
| 1 | b2-first | First | One | grammar | b2-third | Forward prerequisite. |
| 2 | b2-second | Second | One | grammar | b2-first | Fine. |
| 4 | b2-third | Third | One | grammar | b2-second, b2-nowhere | Gap in the order, unknown prerequisite. |

### Unit 2: Two

| # | id | title | unit | type | prerequisites | scope |
|---|---|---|---|---|---|---|
| 4 | b2-fourth | Fourth | Two | grammar | b2-first, b2-second, b2-third, b2-first, b2-second, b2-third, b2-first | Seven prerequisites. |
| 5 | b2-fifth | Fifth | One | grammar | b2-fourth | Splits unit One. |
