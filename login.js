const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycbzTEPhty8799D5Q6LbOTcn10FoUreY2C_kfvOJPCaN2R5pq38DeCOPEsM7mKncsiVFI/exec";
const USER_STORAGE_KEY       = "vocab_user_profile";
const GEMINI_KEY_STORAGE_KEY = "vocab_gemini_api_key";

const loginForm     = document.getElementById("login-form");
const emailInput    = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const loginMessage  = document.getElementById("login-message");

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email    = (emailInput.value || "").trim().toLowerCase();
        const password = (passwordInput.value || "").trim();

        if (!email || !password) return;

        loginMessage.textContent = "Đang đăng nhập...";
        loginMessage.style.color = "#374151";

        try {
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ email, password })
            });

            if (!res.ok) {
                const t = await res.text();
                console.error("Login HTTP error:", res.status, t);
                loginMessage.textContent = "Lỗi server: " + res.status;
                loginMessage.style.color = "#b91c1c";
                return;
            }

            const data = await res.json();
            if (data.status === "success" && data.user) {
                // Lưu profile, kèm geminiKey nếu có
                const userProfile = {
                    email    : data.user.email,
                    name     : data.user.name || "",
                    geminiKey: data.user.geminiKey || ""
                };
                localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));

                // Nếu sheet đã có key (cột C), sync về localStorage luôn
                if (userProfile.geminiKey) {
                    localStorage.setItem(GEMINI_KEY_STORAGE_KEY, userProfile.geminiKey);
                } else {
                    localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
                }

                window.location.href = "index.html";
            } else {
                loginMessage.textContent = data.message || "Đăng nhập thất bại.";
                loginMessage.style.color = "#b91c1c";
            }
        } catch (err) {
            console.error("Login fetch error:", err);
            loginMessage.textContent = "Không kết nối được tới server.";
            loginMessage.style.color = "#b91c1c";
        }
    });
}
