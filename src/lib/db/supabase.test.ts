import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dashboardDb,
  dashboardDbConfigured,
  resetDashboardDbForTest,
} from "./supabase";

const saved = {
  url: process.env.DASHBOARD_SUPABASE_URL,
  key: process.env.DASHBOARD_SUPABASE_SERVICE_KEY,
};

beforeEach(() => {
  resetDashboardDbForTest();
  delete process.env.DASHBOARD_SUPABASE_URL;
  delete process.env.DASHBOARD_SUPABASE_SERVICE_KEY;
});

afterEach(() => {
  resetDashboardDbForTest();
  if (saved.url) process.env.DASHBOARD_SUPABASE_URL = saved.url;
  if (saved.key) process.env.DASHBOARD_SUPABASE_SERVICE_KEY = saved.key;
});

describe("dashboardDb", () => {
  it("env 가 없으면 configured=false, 호출은 명확한 에러", () => {
    expect(dashboardDbConfigured()).toBe(false);
    expect(() => dashboardDb()).toThrow(/DASHBOARD_SUPABASE_URL/);
  });

  it("URL 만 있고 키가 없어도 미설정으로 본다", () => {
    process.env.DASHBOARD_SUPABASE_URL = "https://example.supabase.co";
    expect(dashboardDbConfigured()).toBe(false);
    expect(() => dashboardDb()).toThrow();
  });

  it("둘 다 있으면 클라이언트를 만들고, 같은 인스턴스를 재사용한다", () => {
    process.env.DASHBOARD_SUPABASE_URL = "https://example.supabase.co";
    process.env.DASHBOARD_SUPABASE_SERVICE_KEY = "test-key";
    expect(dashboardDbConfigured()).toBe(true);
    const a = dashboardDb();
    const b = dashboardDb();
    expect(a).toBe(b);
  });

  it("env 가 바뀌면 옛 클라이언트를 버리고 새로 만든다", () => {
    process.env.DASHBOARD_SUPABASE_URL = "https://example.supabase.co";
    process.env.DASHBOARD_SUPABASE_SERVICE_KEY = "old-key";
    const a = dashboardDb();
    process.env.DASHBOARD_SUPABASE_SERVICE_KEY = "new-key";
    const b = dashboardDb();
    expect(b).not.toBe(a);
  });
});
