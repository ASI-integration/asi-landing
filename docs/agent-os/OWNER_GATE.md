# ASI Agent OS — owner gate contract

## Назначение

Owner gate отделяет технический предохранитель от разрешения Николая. Значение workflow input, checkbox, label, typed confirmation или manual dispatch никогда само по себе не является owner approval.

## Правило

Red-действие допустимо только когда один approval artifact содержит:

1. явный статус `approved`;
2. источник `explicit_owner_message`;
3. конкретное действие и exact target;
4. ref/SHA, migration или record identity, когда применимо;
5. допустимый side effect;
6. ожидаемую post-action verification;
7. срок действия approval в текущем task cycle.

Approval атомарен: разрешение deploy не разрешает migration, data mutation, rollback или сообщение. Новый action требует нового artifact.

## Machine contract

Schema: [`schemas/owner-gate.schema.json`](schemas/owner-gate.schema.json).

Runtime validation compiles the Draft 2020-12 schema and then compares the artifact with the expected task, action, exact target, identity, allowed side effect, verification plan and task cycle. Structural validity alone never authorizes an action.

Fail-closed правила:

- `missing`, `rejected`, `expired` и `consumed` блокируют red action;
- `typedConfirmation.present=true` всегда сопровождается `countsAsOwnerApproval=false`;
- несовпадение target, SHA/record identity или action блокирует выполнение;
- секреты указываются только именами, значения запрещены;
- artifact не переносится между tasks и не переиспользуется после action.
- approved artifact без ожидаемого runtime contract, а также artifact со статусом `consumed`, всегда блокирует действие.

## Safe default

Без валидного approval агент возвращает `AWAITING_OWNER` с готовым preflight и не вызывает workflow, provider или mutation path.
