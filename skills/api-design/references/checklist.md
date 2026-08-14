# API Design — Review Checklist

## Names

- [ ] Descriptive and unambiguous; no abbreviations unless ubiquitous (e.g. `id`, `url`).
- [ ] Consistent with sibling functions/endpoints.
- [ ] Verbs for actions, nouns for data, `is`/`has`/`can` for predicates.

## Parameters

- [ ] Fewer than ~4 positional parameters; beyond that use an options object or named args.
- [ ] Consistent parameter order across related functions (e.g. context first or last).
- [ ] Required data is a required parameter, not an optional one with a silent default.
- [ ] No boolean trap (`doThing(false)`); prefer two functions or an enum.

## Return values

- [ ] Return type is the natural result, not a status code or wrapper unless needed.
- [ ] Nullability is explicit and documented (when is `undefined`/`null` returned?).
- [ ] Errors are distinguished from empty results (empty array vs. error).

## Errors

- [ ] Errors are specific and actionable (what went wrong and what to do).
- [ ] Fail fast on invalid input; validate at the boundary.
- [ ] Error shape is consistent across the API.

## State & side effects

- [ ] Pure functions are pure; state-changing functions are named as such.
- [ ] Side effects are documented and minimized.

## HTTP/REST (if applicable)

- [ ] Resources are nouns, collections are plural (`/users`, `/users/:id`).
- [ ] Methods map to intent (GET read, POST create, PUT/PATCH update, DELETE remove).
- [ ] Idempotent operations (PUT, DELETE) are safe to retry.
- [ ] Status codes are correct and consistent (201 created, 204 no content, 404 not found, 409 conflict, 422 validation).
- [ ] Responses have a stable, documented schema; versioned if breaking.

## Compatibility

- [ ] Additive changes only unless a breaking change is deliberate and versioned.
- [ ] Defaults chosen for new optional parameters preserve existing behavior.
- [ ] Deprecations are announced before removal.

## Anti-patterns

| Bad                                     | Good                                    | Why                                |
| --------------------------------------- | --------------------------------------- | ---------------------------------- |
| `processData(data)`                     | `parseOrder(input)`                     | generic name hides intent          |
| `createUser(name, "", false, null)`     | `createUser({ name })`                  | positional overload + boolean trap |
| returning `null` on "not found" vs `[]` | return `[]` for lists, throw for errors | null conflates error with empty    |
| `update(id, body, true)`                | `replaceUser(id, body)`                 | boolean trap                       |
| `GET /getUser?id=1`                     | `GET /users/1`                          | verb in path, wrong resource shape |
| catching and swallowing errors          | let it fail or wrap with context        | silent failures hide bugs          |
