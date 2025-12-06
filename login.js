const LOGIN_API_URL = "https://script.google.com/macros/s/AKfycbyR5Q95O9snPcgjLJweQKY9s_qV9HwK1Q6MsJJHfBxzf1Tu-5ScwdcUoze80zZ2h2bf/exec";   // URL Web App LoginScript.gs (/exec)
const USER_STORAGE_KEY = "vocab_user_profile";

// Nếu đã login rồi thì vào luôn index.html
(function autoRedirectIfLoggedIn() {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY);
        if (raw) {
            const user = JSON.parse(raw);
            if (user && user.email) {
                window.location.href = "index.html";
            }
        }
    } catch (e) {
        console.error("Lỗi đọc user từ localStorage:", e);
    }
})();

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const loginMessage = document.getElementById("login-message");

async function doLogin() {
    loginMessage.style.color = "red";
    loginMessage.textContent = "Đang kiểm tra...";

    const email = (loginEmail.value || "").trim().toLowerCase();
    const password = (loginPassword.value || "").trim();

    if (!email || !password) {
        loginMessage.textContent = "Vui lòng nhập đủ email & password";
        return;
    }

    try {
        const res = await fetch(LOGIN_API_URL, {
            method: "POST",
            mode: "cors",
            // text/plain => "simple request" => KHÔNG gửi OPTIONS preflight
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ email, password })
        });

        if (!res.ok) {
            const text = await res.text();
            console.error("Login API status:", res.status, text);
            loginMessage.textContent = "Lỗi server: " + res.status;
            return;
        }

        let data;
        try {
            data = await res.json();
        } catch (e) {
            const text = await res.text();
            console.error("Không parse được JSON, response:", text);
            loginMessage.textContent = "Server trả về dữ liệu không hợp lệ";
            return;
        }

        if (data.status === "success") {
            loginMessage.style.color = "green";
            loginMessage.textContent = "Đăng nhập thành công!";

            const profile = {
                email: data.user && data.user.email ? data.user.email : email,
                name: data.user && data.user.name ? data.user.name : ""
            };
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));

            setTimeout(() => {
                window.location.href = "index.html";
            }, 600);
        } else {
            loginMessage.textContent = data.message || "Sai thông tin đăng nhập";
        }

    } catch (err) {
        console.error("Fetch login lỗi:", err);
        loginMessage.textContent = "Không kết nối được tới server (check lại URL / WebApp)";
    }
}

if (loginSubmit) {
    loginSubmit.addEventListener("click", doLogin);
}

[loginEmail, loginPassword].forEach(el => {
    el.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
            doLogin();
        }
    });
});
