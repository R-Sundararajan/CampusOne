
import http from "k6/http";
import { check, sleep } from "k6";

// CampusOne load and stress test.
// All application requests are read-only, except one login per VU.
// Run only against your local development/test instance.

const BASE_URL = (
  __ENV.BASE_URL || "http://127.0.0.1:5173"
).replace(/\/+$/, "");

const PROFILE = __ENV.PROFILE || "smoke";
const EMAIL = __ENV.K6_EMAIL || "";
const PASSWORD = __ENV.K6_PASSWORD || "";

const stagesByProfile = {
  smoke: [
    { duration: "10s", target: 1 },
    { duration: "20s", target: 5 },
    { duration: "10s", target: 0 },
  ],

  load: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "30s", target: 0 },
  ],

  stress: [
    { duration: "1m", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 100 },
    { duration: "1m", target: 100 },
    { duration: "1m", target: 200 },
    { duration: "1m", target: 200 },
    { duration: "1m", target: 300 },
    { duration: "1m", target: 300 },
    { duration: "30s", target: 0 },
  ],
};

if (!stagesByProfile[PROFILE]) {
  throw new Error(
    `Unknown PROFILE "${PROFILE}". Use smoke, load, or stress.`
  );
}

if (!EMAIL || !PASSWORD) {
  throw new Error(
    "Set K6_EMAIL and K6_PASSWORD to a local test account."
  );
}

const latencyLimit =
  PROFILE === "stress" ? "p(95)<2000" : "p(95)<500";

const failureLimit =
  PROFILE === "stress" ? "rate<0.05" : "rate<0.01";

const checkLimit =
  PROFILE === "stress" ? "rate>0.95" : "rate>0.99";

export const options = {
  stages: stagesByProfile[PROFILE],

  thresholds: {
    http_req_failed: [failureLimit],
    checks: [checkLimit],

    "http_req_duration{endpoint:ready}": [latencyLimit],
    "http_req_duration{endpoint:auth_me}": [latencyLimit],
    "http_req_duration{endpoint:events_catalog}": [latencyLimit],
    "http_req_duration{endpoint:complaints_catalog}": [latencyLimit],
  },

  summaryTrendStats: [
    "avg",
    "min",
    "med",
    "max",
    "p(90)",
    "p(95)",
    "p(99)",
  ],
};

// Each VU has its own cookie jar and authentication state.
let authState = "new";

// Check an endpoint and report useful diagnostics on failure.
function checkResponse(response, checkName) {
  const ok = check(response, {
    [checkName]: (r) => r.status === 200,
  });

  if (!ok) {
    console.error(
      `${checkName}: status=${response.status}, ` +
      `url=${response.url}, ` +
      `body=${String(response.body || "").slice(0, 300)}`
    );
  }

  return ok;
}

export default function () {
  // Log in once per virtual user.
  // k6 manages cookies separately for each VU.
  if (authState === "new") {
    const login = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          Origin: BASE_URL,
        },
        tags: { endpoint: "login" },
      }
    );
    console.log(
  `Login Set-Cookie header present: ${
    Boolean(login.headers["Set-Cookie"])
  }`
);

console.log(
  `Cookie names returned by login: ${
    Object.keys(login.cookies || {}).join(", ") || "(none)"
  }`
);

console.log(
  `Cookie names in k6 jar: ${
    Object.keys(
      http.cookieJar().cookiesForURL(
        `${BASE_URL}/api/auth/me`
      )
    ).join(", ") || "(none)"
  }`
);
    // Do not print credentials or session cookies.
    console.log(`Login diagnostic: status=${login.status}`);

    const loginOK = checkResponse(
      login,
      "login returns HTTP 200"
    );

    if (!loginOK) {
      authState = "failed";
      console.error(
        `Login failed. Check test credentials, BASE_URL, and APP_ORIGIN.`
      );
      return;
    }

    authState = "authenticated";
  }
  
  if (authState !== "authenticated") {
    sleep(1);
    return;
  }

  // Check application and database readiness.
  const ready = http.get(
    `${BASE_URL}/api/health/ready`,
    { tags: { endpoint: "ready" } }
  );

  checkResponse(ready, "readiness returns HTTP 200");

  // Simulate common read-only user activity.
  const choice = Math.random();

  if (choice < 0.5) {
    const response = http.get(
      `${BASE_URL}/api/events/catalog`,
      { tags: { endpoint: "events_catalog" } }
    );

    checkResponse(
      response,
      "events catalog returns HTTP 200"
    );
  } else if (choice < 0.85) {
    const response = http.get(
      `${BASE_URL}/api/complaints/catalog`,
      { tags: { endpoint: "complaints_catalog" } }
    );

    checkResponse(
      response,
      "complaints catalog returns HTTP 200"
    );
  } else {
    const response = http.get(
      `${BASE_URL}/api/auth/me`,
      { tags: { endpoint: "auth_me" } }
    );

    checkResponse(
      response,
      "current-user endpoint returns HTTP 200"
    );
  }

  // Simulate user think time.
  sleep(1 + Math.random() * 2);
}
