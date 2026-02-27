# Admin Membership SOP (`app_admins`)

Last updated: 2026-02-27
Owner: Fiber Link ops (`@Keith-CY`)

This SOP defines how to grant/revoke `COMMUNITY_ADMIN` app scope and how to audit membership changes.

## 1. Preconditions

- Operator has `SUPER_ADMIN` authorization and DB access.
- Target admin identity exists in `admin_users`.
- Target app exists in `apps`.

## 2. Grant Membership

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "insert into app_admins (app_id, admin_user_id) values ('<app_id>', '<admin_user_id>');"
```

## 3. Revoke Membership

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "delete from app_admins where app_id = '<app_id>' and admin_user_id = '<admin_user_id>';"
```

## 4. Audit Queries

List current memberships:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select app_id, admin_user_id, created_at from app_admins order by app_id, admin_user_id;"
```

List all `COMMUNITY_ADMIN` users and managed app counts:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select u.id as admin_user_id, u.email, count(a.id) as managed_apps from admin_users u left join app_admins a on a.admin_user_id = u.id where u.role = 'COMMUNITY_ADMIN' group by u.id, u.email order by u.email;"
```

## 5. Policy Coupling Requirement

After granting a new app membership, verify withdrawal policy presence for that app:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select app_id, allowed_assets, max_per_request, per_user_daily_max, per_app_daily_max, cooldown_seconds from withdrawal_policies where app_id = '<app_id>';"
```

If no row exists, create one through admin API `withdrawalPolicy.upsert` before enabling live withdrawals.
