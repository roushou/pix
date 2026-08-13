# Conventional Commits — Examples & Edge Cases

## Basic

```
feat: add user login
fix: handle empty response body
docs: update installation guide
```

## With scope

```
feat(auth): add OAuth2 support
fix(parser): correct off-by-one in line numbers
refactor(config): extract validation into helper
```

## Breaking change (shorthand `!`)

```
feat(api)!: remove deprecated /v1 endpoints
```

## Breaking change (footer)

```
feat(api): return 400 for invalid input

BREAKING CHANGE: the `limit` query parameter is now required; requests
without it are rejected with a 400 status.
```

## Multi-paragraph body

```
fix(parser): handle CRLF line endings

The tokenizer assumed `\n` and silently dropped the final token on files
with Windows line endings.

Split on `\r?\n` instead, and add a regression test covering CRLF input.

Refs #412
```

## Revert

```
revert: feat(api): add rate limiting

This reverts commit 3f8a1c2.
```

## Anti-patterns

| Bad                                                                     | Good                                      | Why                            |
| ----------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `feat: Added user login`                                                | `feat: add user login`                    | imperative + lowercase         |
| `fix: corrected parser bug.`                                            | `fix: correct parser bug`                 | no trailing period, imperative |
| `Fixed the login bug`                                                   | `fix: correct login bug`                  | missing type                   |
| `chore: stuff`                                                          | `chore: update dev dependencies`          | vague subject                  |
| `feat(auth): add OAuth2 support for all the providers that exist today` | `feat(auth): add OAuth2 provider support` | subject too long               |

## Choosing the type

- **feat** — new user-facing capability
- **fix** — bug fix for incorrect behavior
- **docs** — documentation only
- **style** — formatting, whitespace, lint (no behavior change)
- **refactor** — code change that neither fixes a bug nor adds a feature
- **perf** — performance improvement
- **test** — adding or fixing tests
- **build** — build system or external dependencies
- **ci** — CI configuration
- **chore** — other changes that don't modify source or tests
- **revert** — reverts a previous commit
