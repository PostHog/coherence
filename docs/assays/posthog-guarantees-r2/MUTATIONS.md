# Applied counterfactuals

Each applies only to the isolated PostHog checkout at c54fec2163ad9455fd23a947f86a9034c1df9388. All were restored. Do not apply them together when reproducing attribution.

## Acknowledgment barrier

`nodejs/src/ingestion/api/grpc-server.ts`, inside `settleAndAck`:

```diff
-                await completed.settled
+                void completed.settled
```

Run the unchanged original `grpc-server.test.ts`; record named assertions, not just exit status.

## Tenant filter

`posthog/models/scoping/manager.py`, inside `TeamScopedQuerySet._apply_team_filter`:

```diff
-        return self.filter(team_id=team_id)
+        return self
```

The executed oracle was the fallback harness's `TenantPrimitive`, not the original Django test class. The optional missing-context mutation from the protocol was not performed.

## Cache supersession

`posthog/query_cache/size_tracker.py`, inside the literal `REPLACE_IF_UNCHANGED_SCRIPT`:

```diff
-if current ~= ARGV[1] then
-    return 0
-end
 redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
```

The executed oracle was the fallback harness's `CacheSwapPrimitive`.

## Cache retry recognition

Same Lua script, restored before this mutation:

```diff
-if current == ARGV[2] then
-    return 2
-end
 if current ~= ARGV[1] then
```

The executed oracle was the fallback harness's `CacheSwapPrimitive`. This checks the retry result and stored pointer, not the S3 cleanup composition.
