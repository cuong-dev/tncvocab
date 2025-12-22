const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycby6IISpVGmgSipGIzB1sX1XDfQBn8AYCByLT5m9knc5kL6E9-xXdD1N12fxJkpXXyCp/exec";
const USER_STORAGE_KEY       = "vocab_user_profile";
const GEMINI_KEY_STORAGE_KEY = "vocab_gemini_api_key";

// DOM Elements
const loginForm      = document.getElementById("login-form");
const registerForm   = document.getElementById("register-form");
const loginMessage   = document.getElementById("login-message");
const pageSubtitle   = document.getElementById("page-subtitle");

// Inputs Login
const loginEmail     = document.getElementById("login-email");
const loginPass      = document.getElementById("login-password");

// Inputs Register
const regName        = document.getElementById("reg-name");
const regEmail       = document.getElementById("reg-email");
const regPass        = document.getElementById("reg-password");
const regConfirm     = document.getElementById("reg-confirm");

// Switch Buttons
const goToRegister   = document.getElementById("go-to-register");
const goToLogin      = document.getElementById("go-to-login");

// --- 1. CHUYỂN ĐỔI UI LOGIN / REGISTER ---
if (goToRegister) {
    goToRegister.addEventListener("click", (e) => {
        e.preventDefault();
        loginForm.style.display = "none";
        registerForm.style.display = "block";
        pageSubtitle.textContent = "Tạo tài khoản mới";
        loginMessage.textContent = "";
    });
}

if (goToLogin) {
    goToLogin.addEventListener("click", (e) => {
        e.preventDefault();
        registerForm.style.display = "none";
        loginForm.style.display = "block";
        pageSubtitle.textContent = "Đăng nhập để tiếp tục";
        loginMessage.textContent = "";
    });
}

// --- 2. XỬ LÝ ĐĂNG NHẬP ---
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = (loginEmail.value || "").trim().toLowerCase();
        const password = (loginPass.value || "").trim();

        if (!email || !password) return;

        showLoading("Đang đăng nhập...");

        try {
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "login", email, password }) 
                // Lưu ý: Thêm action: "login" để server phân biệt
            });

            const data = await res.json();
            handleAuthResponse(data);

        } catch (err) {
            showError("Lỗi kết nối server.");
            console.error(err);
        }
    });
}

// --- 3. XỬ LÝ ĐĂNG KÝ ---
if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = (regName.value || "").trim();
        const email = (regEmail.value || "").trim().toLowerCase();
        const password = (regPass.value || "").trim();
        const confirm = (regConfirm.value || "").trim();

        if (password.length < 6) {
            showError("Mật khẩu phải từ 6 ký tự trở lên.");
            return;
        }
        if (password !== confirm) {
            showError("Mật khẩu nhập lại không khớp.");
            return;
        }

        showLoading("Đang tạo tài khoản...");

        try {
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ 
                    action: "register", 
                    email, 
                    password, 
                    name 
                })
            });

            const data = await res.json();
            if (data.status === "success") {
                // Đăng ký thành công -> Tự động đăng nhập luôn
                handleAuthResponse(data);
            } else {
                showError(data.message || "Đăng ký thất bại.");
            }

        } catch (err) {
            showError("Lỗi kết nối server.");
            console.error(err);
        }
    });
}

// --- HELPER FUNCTIONS ---
function showLoading(msg) {
    loginMessage.textContent = msg;
    loginMessage.style.color = "#374151";
}

function showError(msg) {
    loginMessage.textContent = msg;
    loginMessage.style.color = "#b91c1c";
}

function handleAuthResponse(data) {
    if (data.status === "success" && data.user) {
        const userProfile = {
            email: data.user.email,
            name: data.user.name || "",
            geminiKey: data.user.geminiKey || "",
            expiryDate: data.user.expiryDate,// Lưu ngày hạn
            regDate: data.user.regDate
        };
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));

        // Sync key
        if (userProfile.geminiKey) {
            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, userProfile.geminiKey);
        } else {
            localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        }

        window.location.href = "index.html";
    } else {
        showError(data.message || "Đăng nhập thất bại.");
    }
}
