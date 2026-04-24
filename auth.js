// auth.js — Security+ SY0-701 authentication module (Cognito REST API)
// Uses AWS Cognito User Pool via direct REST calls (no SDK dependency)

const COGNITO_USER_POOL_ID = 'us-east-1_rMi0Wp16X';
const COGNITO_CLIENT_ID    = 'linprrd7jb2slstmmtommjbsq';
const COGNITO_REGION       = 'us-east-1';
const COGNITO_ENDPOINT     = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com`;

const STORAGE_PREFIX = 'secplus-auth-v1';
const STORAGE_KEYS = {
  idToken:      `${STORAGE_PREFIX}-idToken`,
  accessToken:  `${STORAGE_PREFIX}-accessToken`,
  refreshToken: `${STORAGE_PREFIX}-refreshToken`,
  user:         `${STORAGE_PREFIX}-user`,
  expiry:       `${STORAGE_PREFIX}-expiry`,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function cognitoFetch(action, payload) {
  return fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(payload),
  }).then(async res => {
    const data = await res.json();
    if (!res.ok) {
      const errType = data.__type || 'UnknownError';
      const errMsg  = data.message || data.Message || 'An error occurred';
      const err = new Error(errMsg);
      err.code = errType;
      throw err;
    }
    return data;
  });
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function storeTokens(authResult) {
  if (authResult.IdToken)      localStorage.setItem(STORAGE_KEYS.idToken,      authResult.IdToken);
  if (authResult.AccessToken)  localStorage.setItem(STORAGE_KEYS.accessToken,  authResult.AccessToken);
  if (authResult.RefreshToken) localStorage.setItem(STORAGE_KEYS.refreshToken, authResult.RefreshToken);
  if (authResult.ExpiresIn) {
    const expiry = Date.now() + authResult.ExpiresIn * 1000;
    localStorage.setItem(STORAGE_KEYS.expiry, String(expiry));
  }
  const idPayload = parseJwt(authResult.IdToken);
  if (idPayload) {
    const user = { email: idPayload.email || '', sub: idPayload.sub || '' };
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  }
}

function clearTokens() {
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

// ── Token refresh ────────────────────────────────────────────────────────

let refreshPromise = null;

async function refreshTokens() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) { clearTokens(); return false; }
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const data = await cognitoFetch('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
      storeTokens(data.AuthenticationResult);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Public API: Auth state ───────────────────────────────────────────────

export function isLoggedIn() {
  const token  = localStorage.getItem(STORAGE_KEYS.accessToken);
  const expiry = localStorage.getItem(STORAGE_KEYS.expiry);
  if (!token) return false;
  if (expiry && Date.now() > Number(expiry)) {
    return !!localStorage.getItem(STORAGE_KEYS.refreshToken);
  }
  return true;
}

export function getUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.user);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function getToken() {
  const expiry = localStorage.getItem(STORAGE_KEYS.expiry);
  const token  = localStorage.getItem(STORAGE_KEYS.idToken);
  if (!token) return null;
  if (expiry && Date.now() > Number(expiry) - 5 * 60 * 1000) {
    const ok = await refreshTokens();
    if (!ok) return null;
  }
  return localStorage.getItem(STORAGE_KEYS.idToken);
}

export function getTokenSync() {
  return localStorage.getItem(STORAGE_KEYS.idToken) || null;
}

// ── Public API: Auth actions ─────────────────────────────────────────────

export async function register(email, password) {
  try {
    await cognitoFetch('SignUp', {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    });
    return { success: true, needsConfirmation: true };
  } catch (err) {
    return { success: false, error: friendlyError(err) };
  }
}

export async function confirmEmail(email, code) {
  try {
    await cognitoFetch('ConfirmSignUp', {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: friendlyError(err) };
  }
}

export async function login(email, password) {
  try {
    const data = await cognitoFetch('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    storeTokens(data.AuthenticationResult);
    const user = getUser();
    return { success: true, user };
  } catch (err) {
    if (err.code === 'UserNotConfirmedException') {
      return { success: false, error: 'Please confirm your email first.', needsConfirmation: true };
    }
    return { success: false, error: friendlyError(err) };
  }
}

export function logout() {
  clearTokens();
  window.dispatchEvent(new CustomEvent('auth-logout'));
}

export async function forgotPassword(email) {
  try {
    await cognitoFetch('ForgotPassword', { ClientId: COGNITO_CLIENT_ID, Username: email });
    return { success: true };
  } catch (err) {
    return { success: false, error: friendlyError(err) };
  }
}

export async function resetPassword(email, code, newPassword) {
  try {
    await cognitoFetch('ConfirmForgotPassword', {
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: friendlyError(err) };
  }
}

// ── Auth guard ───────────────────────────────────────────────────────────

export function requireAuth() {
  if (isLoggedIn()) return true;
  const loginPath = location.pathname.includes('/pages/')
    ? './login.html'
    : './pages/login.html';
  window.location.href = loginPath;
  return false;
}

// ── Lock overlay (for gated content) ─────────────────────────────────────

export function showLockOverlay(containerEl, featureName) {
  if (!containerEl) return;
  containerEl.style.position = 'relative';

  const loginPath = location.pathname.includes('/pages/') ? './login.html' : './pages/login.html';

  const overlay = document.createElement('div');
  overlay.className = 'auth-lock-overlay';
  overlay.innerHTML = `
    <div class="auth-lock-box">
      <div class="auth-lock-icon">&#128274;</div>
      <h3>Create a free account to access ${escapeHtml(featureName)}</h3>
      <p>Sign up in seconds — it's completely free.</p>
      <a href="${loginPath}" class="auth-lock-btn">Sign Up Free</a>
      <p class="auth-lock-login">Already have an account? <a href="${loginPath}">Log in</a></p>
    </div>
  `;
  containerEl.appendChild(overlay);
}

(function injectLockStyles() {
  if (document.getElementById('auth-lock-styles')) return;
  const style = document.createElement('style');
  style.id = 'auth-lock-styles';
  style.textContent = `
    .auth-lock-overlay {
      position: absolute; inset: 0; z-index: 50;
      display: flex; align-items: center; justify-content: center;
      background: rgba(7, 9, 15, 0.88); backdrop-filter: blur(6px); border-radius: 14px;
    }
    .auth-lock-box { text-align: center; max-width: 360px; padding: 2rem; }
    .auth-lock-icon { font-size: 2.5rem; margin-bottom: .75rem; }
    .auth-lock-box h3 { font-size: 1.15rem; color: #fff; margin: 0 0 .5rem; line-height: 1.4; }
    .auth-lock-box p { font-size: .9rem; color: rgba(255,255,255,.55); margin: 0 0 1.25rem; }
    .auth-lock-btn {
      display: inline-block;
      background: linear-gradient(135deg, #0066cc 0%, #0099ff 100%);
      color: #fff; text-decoration: none; padding: .65rem 2rem;
      border-radius: 10px; font-weight: 700; font-size: 1rem;
      box-shadow: 0 4px 18px rgba(0,153,255,.3); transition: opacity .15s;
    }
    .auth-lock-btn:hover { opacity: .9; }
    .auth-lock-login { font-size: .82rem !important; margin-top: 1rem !important; }
    .auth-lock-login a { color: #0099ff; text-decoration: none; }
    .auth-lock-login a:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
})();

// ── Friendly errors ──────────────────────────────────────────────────────

function friendlyError(err) {
  const code = err.code || '';
  if (code.includes('UsernameExists'))   return 'An account with this email already exists.';
  if (code.includes('InvalidPassword'))  return 'Password must be at least 8 characters with uppercase, lowercase, and a number.';
  if (code.includes('NotAuthorized'))    return 'Incorrect email or password.';
  if (code.includes('UserNotFound'))     return 'No account found with this email.';
  if (code.includes('CodeMismatch'))     return 'Invalid verification code. Please try again.';
  if (code.includes('ExpiredCode'))      return 'Verification code has expired. Please request a new one.';
  if (code.includes('LimitExceeded'))    return 'Too many attempts. Please try again later.';
  if (code.includes('InvalidParameter')) return 'Please check your input and try again.';
  return err.message || 'Something went wrong. Please try again.';
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
