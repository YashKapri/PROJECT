/* === main.js === */


fetch('/join-now', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify(payload)
});
// === Utility Functions ===
/**
 * Helper function to send JSON data via POST request.
 */
const postJSON = (url, data) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: 'same-origin' // Important for auth cookies
  }).then(r => r.json());

// === Payment Modal & Form Functions ===
// These are defined globally so onclick/onsubmit attributes in the HTML can find them.

/**
 * Handles the "Buy Now" buttons in the pricing section.
 */
// ---------- Helper: smooth scroll to Join section ----------
function scrollToJoin() {
  const el = document.getElementById('section_join') || document.getElementById('section2') || document.querySelector('#section_join');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Helper: get current user (/me) ----------
async function getMe() {
  try {
    const r = await fetch('/me', { credentials: 'same-origin' });
    if (!r.ok) return { user: null };
    return await r.json();
  } catch (err) {
    console.warn('getMe failed', err);
    return { user: null };
  }
}


/**
 * When "Sign Up Free" clicked:
 * - If logged in -> redirect to platform.html
 * - If NOT logged in -> redirect to account.html#signup (so user can sign up / login)
 */
async function handleSignUpFreeClick(event) {
  event?.preventDefault?.();

  try {
    // call your existing /me endpoint (same-origin)
    const r = await fetch('/me', { credentials: 'same-origin' });
    if (!r.ok) {
      // if /me returns non-200, treat as not-logged-in
      window.location.href = '/account.html#signup';
      return;
    }

    const data = await r.json().catch(()=>({ user: null }));
    if (data && data.user) {
      // logged in -> go to platform
      window.location.href = '/platform.html';
    } else {
      // not logged in -> go to account page (signup section)
      // include optional next param so after signup they can be redirected to platform
      window.location.href = '/account.html#signup?next=' + encodeURIComponent('/platform.html');
    }
  } catch (err) {
    console.error('SignUpFree check failed:', err);
    // fallback: send to account page
    window.location.href = '/account.html#signup';
  }
}

// attach handler to button (safe even if DOM loads later)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnSignUpFree');
  if (btn) btn.addEventListener('click', handleSignUpFreeClick);
});

// also expose globally if you prefer inline onclick in HTML
window.handleSignUpFreeClick = handleSignUpFreeClick;


/**
 * Pricing buttons handler — replaces simple simulatePayment.
 * Called from HTML: simulatePayment('Free' | 'Pro' | 'Enterprise')
 */
async function simulatePayment(planLabel) {
  const planRaw = (planLabel || '').toString();
  const plan = planRaw.toLowerCase(); // "free" | "pro" | "enterprise"

  // check login
  const me = await getMe();

  if (plan === 'free') {
    if (!me.user) {
      // Not logged in -> send to signup page
      window.location.href = '/account.html#signup';
    } else {
      // Logged in -> community (public access area)
      window.location.href = '/community';
    }
    return;
  }

  // For Paid plans: scroll to Join section and preselect plan
  scrollToJoin();

  // Preselect the plan in your join form select (if present)
  const sel = document.getElementById('join_plan');
  if (sel) {
    // If your option values are "Pro" or "Enterprise" (case-sensitive), use planLabel
    // Otherwise set to normalized lowercase if your <option value="pro"> etc.
    // Try to find matching option (case-insensitive)
    let matched = false;
    Array.from(sel.options).forEach(opt => {
      if (opt.value.toLowerCase() === plan || opt.text.toLowerCase().includes(plan)) {
        opt.selected = true;
        matched = true;
      }
    });
    if (!matched) {
      // fallback: set raw label (preserve existing UI values)
      try { sel.value = planLabel; } catch (e) { /* ignore */ }
    }
  }

  // focus the first useful input in join form
  const nameInput = document.getElementById('join_name') || document.querySelector('#section_join input[type="text"]');
  if (nameInput) nameInput.focus();
}

// Make sure function is globally available for inline onclick handlers
window.simulatePayment = simulatePayment;

async function signupFree() {
  try {
    const email = prompt("Enter your email to start Free Plan:");
    if (!email) return;

    const resp = await fetch('/signup-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email })
    });

    const json = await resp.json().catch(()=>({}));
    if (!resp.ok) {
      alert(json.error || 'Signup failed.');
      return;
    }

    alert(json.message || 'Signed up successfully!');
    window.location.href = json.redirect || '/platform.html';
  } catch (err) {
    console.error('signupFree error', err);
    alert('Network error. Try again.');
  }
}

    // Determine price for Pro/Enterprise
    const price = plan === 'Pro' ? 150 : 500;
    openPaymentPage(plan, price);

/** Opens a payment modal for the selected plan and price.
 * This is a placeholder function; replace with your actual payment integration.
 * 
 * handleJoinFormSubmit will redirect to payment.html instead.
 */
function openPaymentPage(plan, price) {
  alert(`Proceeding to payment for ${plan} plan at $${price}. (Replace this with actual payment integration.)`);
}

async function handleJoinFormSubmit(event) {
  event.preventDefault();
  const form = event.target;

  const name    = document.getElementById('join_name').value.trim();
  const email   = document.getElementById('join_email').value.trim().toLowerCase();
  const phone   = document.getElementById('join_phone').value.replace(/[^\d+]/g, '').slice(0, 15);
  const details = document.getElementById('join_level').value.trim();
  const goalUI  = (document.getElementById('join_goal').value || '').trim();

  const planSelect = document.getElementById('join_plan');
  const planUI     = (planSelect.value || '').trim(); // "Free" | "Pro" | "Enterprise"
  const price      = parseInt(planSelect.selectedOptions[0]?.getAttribute('data-price') || '0', 10);

  if (!planUI) { alert("Please select a Preferred Plan."); return false; }
  if (!goalUI)  { alert("Please select your Primary Fitness Goal."); return false; }
  if (!name || !email) { alert("Please enter your name and email."); return false; }

  const plan = planUI.toLowerCase();
  const goal = goalUI.toLowerCase();
  const payload = { name, email, phone, plan, goal, details };

  try {
    console.log('POST /join-now ->', payload);
    const resp = await fetch('/join-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });

    console.log('Response status:', resp.status, resp.statusText);

    // safest parse: try JSON, otherwise read text
    let json;
    try {
      json = await resp.clone().json(); // clone so we can also read text if needed
    } catch (parseErr) {
      const raw = await resp.text().catch(() => '<no body>');
      console.error('Failed to parse JSON from /join-now. Raw response:', raw, parseErr);
      alert('Server returned unexpected response. Check console (DevTools) for details.');
      return false;
    }

    console.log('/join-now JSON:', json);

    if (!resp.ok) {
      console.error('Server responded with error:', resp.status, json);
      alert(json.error || 'Server error. Please try again.');
      return false;
    }

    const leadId = json.leadId;
    if (plan === 'free') {
      alert(json.message || 'Thank you — we will contact you soon.');
      form.reset();
      return false;
    }

    // Paid plan -> redirect to payment page (create payment.html to handle)
    const amount = String(price || (plan === 'pro' ? 150 : 500));
    const paymentUrl = `/payment.html?leadId=${encodeURIComponent(leadId||'')}&plan=${encodeURIComponent(plan)}&amount=${encodeURIComponent(amount)}`;
    console.log('Redirecting to payment:', paymentUrl);
    window.location.href = paymentUrl;
    return false;

  } catch (err) {
    // network or unexpected JS error
    console.error('JOIN NOW submit failure (network/exception):', err);
    alert('Network error. Please try again. Check console for details.');
    return false;
  }
}

// === Auth Functions ===
/**
 * Fetches the current user's status and updates the UI.
 * This function will also hide/show the correct forms.
 */
async function refreshMe() {
    // Get all the elements we need to control
    const meElement = document.getElementById('me');
    const loginBox = document.getElementById('login-box');
    const signupBox = document.getElementById('signup-box');
    const signupPrompt = document.getElementById('signup-prompt');
    const logoutBtn = document.getElementById('logout-btn');
    
    try {
        const meRes = await fetch("/me", { credentials:'same-origin' }).then(r => r.json());

        if (meRes.user) {
            // --- USER IS LOGGED IN ---
            if (meElement) {
                // Set text and make sure the status box is visible
                meElement.textContent = `Logged in as ${meRes.user.email}`;
                meElement.style.display = 'block';
            }
            // Hide forms
            if (loginBox) loginBox.style.display = 'none';
            if (signupBox) signupBox.style.display = 'none';
            if (signupPrompt) signupPrompt.style.display = 'none';
            // Show logout button
            if (logoutBtn) logoutBtn.style.display = 'block';

        } else {
            // --- USER IS LOGGED OUT ---
            if (meElement) {
                meElement.textContent = "";
                meElement.style.display = 'none'; // Hide the status box if it's empty
            }
            // Show forms (in default state)
            if (loginBox) loginBox.style.display = 'block';
            if (signupPrompt) signupPrompt.style.display = 'block';
            if (signupBox) signupBox.style.display = 'none'; // Default hidden
            // Hide logout button
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    } catch (error) {
        console.error("Error refreshing user status:", error);
        if (meElement) meElement.textContent = ""; // Hide on error
    }
}

// === DOMContentLoaded Event Listener ===
// This waits for the HTML document to be fully loaded before
// trying to find elements (like forms and buttons) to add listeners to.
// This is the correct way to add listeners.

document.addEventListener("DOMContentLoaded", () => {

    // --- Auth: Sign Up ---
    const signupForm = document.getElementById("signup-form");
    const suEmail = document.getElementById('su-email');
    const suPass = document.getElementById('su-pass');
    const signupMsg = document.getElementById('signup-msg');

    if (signupForm) {
        signupForm.addEventListener("submit", async e => {
            e.preventDefault();
            const email = suEmail.value.trim();
            const password = suPass.value;
            
            signupMsg.textContent = "Creating account...";
            const res = await postJSON("/signup", { email, password });
            signupMsg.textContent = res.error || res.message;
            refreshMe(); // Update login status
        });
    }

    // --- Auth: Login ---
    const loginForm = document.getElementById("login-form");
    const liEmail = document.getElementById('li-email');
    const liPass = document.getElementById('li-pass');
    const loginMsg = document.getElementById('login-msg');

    if (loginForm) {
        loginForm.addEventListener("submit", async e => {
            e.preventDefault();
            const email = liEmail.value.trim();
            const password = liPass.value;

            loginMsg.textContent = "Logging in...";
            const res = await postJSON("/login", { email, password });
            loginMsg.textContent = res.error || res.message;
            refreshMe(); // Update login status
        });
    }

    // --- Auth: Logout ---
    const logoutBtn = document.getElementById("logout-btn");
    const loginMsgForLogout = document.getElementById('login-msg'); // Message area for logout
    
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            const res = await postJSON("/logout", {});
            if (loginMsgForLogout) {
                loginMsgForLogout.textContent = res.message;
            }
            refreshMe(); // Update login status
        });
    }

    // --- Initial User Status Check ---
    // Check if the user is already logged in when the page loads
    refreshMe();
});