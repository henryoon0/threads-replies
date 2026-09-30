/**
 * 대시보드 전용 Supabase(Postgres) 클라이언트.
 *
 * aicoffeechat 운영 DB와는 별개 프로젝트다 (wayfinder #188에서 분리 결정 —
 * 고객 데이터와 사고 반경을 섞지 않는다). 연결 정보는 .env.local:
 *   DASHBOARD_SUPABASE_URL / DASHBOARD_SUPABASE_SERVICE_KEY
 *
 * 서버 코드 전용. service key는 모든 권한을 가지므로 클라이언트 컴포넌트에서
 * import 하지 말 것.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
let cachedFor = "";

export function dashboardDbConfigured(): boolean {
  return Boolean(
    process.env.DASHBOARD_SUPABASE_URL &&
      process.env.DASHBOARD_SUPABASE_SERVICE_KEY
  );
}

export function dashboardDb(): SupabaseClient {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "DASHBOARD_SUPABASE_URL / DASHBOARD_SUPABASE_SERVICE_KEY 가 .env.local 에 없습니다"
    );
  }
  // env 가 바뀌면(키 교체 등) 옛 클라이언트를 버리고 새로 만든다.
  const envKey = `${url}\n${key}`;
  if (cached && cachedFor === envKey) return cached;
  cachedFor = envKey;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** 테스트용: 캐시된 클라이언트를 버린다 (env 를 바꿔 재생성할 때). */
export function resetDashboardDbForTest(): void {
  cached = null;
  cachedFor = "";
}
