// ====== CONFIG ======
const SHEET_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxsEmTs_UViU-oS0pJoc7KyvQhMMvboogJknkr5hl-bTxTG7MTq-rZgHh4rsWElc0jK/exec";  // URL Web App VocabScript.gs (/exec)
const LOGIN_API_URL = "https://script.google.com/macros/s/AKfycbyR5Q95O9snPcgjLJweQKY9s_qV9HwK1Q6MsJJHfBxzf1Tu-5ScwdcUoze80zZ2h2bf/exec";      // URL Web App LoginScript.gs (/exec)
const USER_STORAGE_KEY = "vocab_user_profile";

let words = [];
let currentUser = null;

// ====== DOM ======
const wordForm = document.getElementById("word-form");
const wordInput = document.getElementById("word");
const meaningInput = document.getElementById("meaning");
const folderInput = document.getElementById("folder");
const ipaInput = document.getElementById("ipa");
const typeInput = document.getElementById("type");
const statusSelect = document.getElementById("status");
const sentenceInput = document.getElementById("sentence");

const wordListEl = document.getElementById("word-list");
const wordEmptyEl = document.getElementById("word-empty");
const totalCountPill = document.getElementById("total-count-pill");

const reloadButton = document.getElementById("reload-button");
const searchInput = document.getElementById("search-input");
const quizButton = document.getElementById("quiz-button");
const quizBox = document.getElementById("quiz-box");
const quizQuestion = document.getElementById("quiz-question");
const quizAnswer = document.getElementById("quiz-answer");

const userDisplay = document.getElementById("user-display");
const logoutButton = document.getElementById("logout-button");

// change password modal
const changePwButton = document.getElementById("change-password-button");
const changePwModal = document.getElementById("change-password-modal");
const changePwForm = document.getElementById("change-password-form");
const oldPwInput = document.getElementById("old-password");
const newPwInput = document.getElementById("new-password");
const confirmPwInput = document.getElementById("confirm-password");
const cancelChangePw = document.getElementById("cancel-change-password");
const changePwMessage = document.getElementById("change-password-message");

// ====== USER PROFILE + CHECK LOGIN ======
function requireLoginOrRedirect() {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY);
        if (!raw) {
            window.location.href = "login.html";
            return;
        }
        currentUser = JSON.parse(raw);
        if (!currentUser || !currentUser.email) {
            window.location.href = "login.html";
            return;
        }
    } catch (e) {
        console.error("Lỗi đọc user profile:", e);
        window.location.href = "login.html";
        return;
    }
    updateUserUI();
}

function updateUserUI() {
    if (!userDisplay) return;

    if (currentUser && currentUser.name) {
        userDisplay.textContent = currentUser.name + (currentUser.email ? ` (${currentUser.email})` : "");
    } else if (currentUser && currentUser.email) {
        userDisplay.textContent = currentUser.email;
    } else {
        userDisplay.textContent = "Khách (chưa đăng nhập)";
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", () => {
        localStorage.removeItem(USER_STORAGE_KEY);
        window.location.href = "login.html";
    });
}

// ====== MODAL ĐỔI MẬT KHẨU ======
function openChangePwModal() {
    if (!currentUser || !currentUser.email) {
        alert("Bạn cần đăng nhập lại trước khi đổi mật khẩu.");
        return;
    }
    changePwMessage.textContent = "";
    changePwMessage.className = "modal-message";
    oldPwInput.value = "";
    newPwInput.value = "";
    confirmPwInput.value = "";
    changePwModal.style.display = "flex";
}

function closeChangePwModal() {
    changePwModal.style.display = "none";
}

// ====== GOOGLE SHEETS – VOCAB (THEO EMAIL) ======
async function fetchWordsFromSheet() {
    if (!currentUser || !currentUser.email) {
        console.warn("Chưa có currentUser hoặc email, không thể fetch.");
        return;
    }

    const url = `${SHEET_WEB_APP_URL}?userEmail=${encodeURIComponent(
        currentUser.email.toLowerCase()
    )}`;

    try {
        const res = await fetch(url, {
            method: "GET"
        });
        const data = await res.json();

        if (data.status === "success" && Array.isArray(data.words)) {
            words = data.words.map(w => ({
                word: w.word || "",
                folder: w.folder || "",
                ipa: w.ipa || "",
                type: w.type || "",
                meaning: w.meaning || "",
                sentence: w.sentence || "",
                dateAdded: w.dateAdded || "",
                status: w.status || ""
            }));
        } else {
            console.warn("Dữ liệu vocab không hợp lệ:", data);
            words = [];
        }
    } catch (err) {
        console.error("Lỗi fetch vocab từ Google Sheets:", err);
        words = [];
    }
}

function sendWordToGoogleSheet(word) {
    if (!currentUser || !currentUser.email) {
        alert("Chưa đăng nhập, không thể lưu từ.");
        return;
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase()
    };

    fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
          if (data.status !== "success") {
              console.warn("Gửi Google Sheets lỗi:", data);
          }
      })
      .catch(err => {
          console.error("Fetch POST Sheets error:", err);
      });
}

// ====== UI HELPER ======
function getTypeTagClass(type) {
    if (!type) return "tag-other";
    const t = type.toLowerCase();
    if (t.includes("noun")) return "tag-A1";
    if (t.includes("verb")) return "tag-A2";
    if (t.includes("adj")) return "tag-B1";
    if (t.includes("adv")) return "tag-B2";
    if (t.includes("phrase")) return "tag-C1";
    return "tag-other";
}

function getStatusClass(status) {
    switch (status) {
        case "new": return "status-new";
        case "learning": return "status-learning";
        case "review": return "status-review";
        case "mastered": return "status-mastered";
        default: return "status-new";
    }
}

function renderWords(filterText = "") {
    const rows = Array.from(wordListEl.querySelectorAll(".word-row"));
    rows.forEach((row, index) => {
        if (index === 0) return; // giữ header
        row.remove();
    });

    let visibleCount = 0;
    const text = filterText.trim().toLowerCase();

    words.forEach((w) => {
        if (text) {
            const match = (
                (w.word || "") + " " +
                (w.meaning || "") + " " +
                (w.folder || "")
            ).toLowerCase().includes(text);
            if (!match) return;
        }

        visibleCount++;

        const row = document.createElement("div");
        row.className = "word-row";

        const wordCell = document.createElement("div");
        wordCell.textContent = w.word;

        const meaningCell = document.createElement("div");
        meaningCell.textContent = w.meaning;

        const sentenceCell = document.createElement("div");
        sentenceCell.textContent = w.sentence || "—";

        const typeCell = document.createElement("div");
        const typeSpan = document.createElement("span");
        typeSpan.className = "tag-level " + getTypeTagClass(w.type);
        typeSpan.textContent = w.type || "—";
        typeCell.appendChild(typeSpan);

        const folderCell = document.createElement("div");
        folderCell.textContent = w.folder || "—";

        const statusCell = document.createElement("div");
        const statusSpan = document.createElement("span");
        statusSpan.className = "status-pill " + getStatusClass(w.status);
        statusSpan.textContent = w.status || "new";
        statusCell.appendChild(statusSpan);

        row.appendChild(wordCell);
        row.appendChild(meaningCell);
        row.appendChild(sentenceCell);
        row.appendChild(typeCell);
        row.appendChild(folderCell);
        row.appendChild(statusCell);

        wordListEl.appendChild(row);
    });

    wordEmptyEl.style.display = words.length === 0 || visibleCount === 0 ? "block" : "none";
}

function updateCount() {
    const span = totalCountPill.querySelector("span:last-child");
    if (span) span.textContent = words.length + " từ";
}

// ====== EVENTS ======
if (wordForm) {
    wordForm.addEventListener("submit", (e) => {
        e.preventDefault();

        const word = (wordInput.value || "").trim();
        const meaning = (meaningInput.value || "").trim();
        const folder = (folderInput.value || "").trim();
        const ipa = (ipaInput.value || "").trim();
        const type = (typeInput.value || "").trim();
        const status = statusSelect.value || "new";
        const sentence = (sentenceInput.value || "").trim();

        if (!word || !meaning) return;

        const newWord = {
            word,
            meaning,
            folder,
            ipa,
            type,
            sentence,
            status
        };

        words.push({
            ...newWord,
            dateAdded: ""
        });
        renderWords(searchInput.value);
        updateCount();

        sendWordToGoogleSheet(newWord);

        wordInput.value = "";
        meaningInput.value = "";
        folderInput.value = "";
        ipaInput.value = "";
        typeInput.value = "";
        sentenceInput.value = "";
        statusSelect.value = "new";
        wordInput.focus();
    });
}

if (reloadButton) {
    reloadButton.addEventListener("click", async () => {
        await fetchWordsFromSheet();
        renderWords(searchInput.value);
        updateCount();
    });
}

if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        renderWords(e.target.value);
    });
}

if (quizButton) {
    quizButton.addEventListener("click", () => {
        if (words.length === 0) {
            alert("Chưa có từ nào để quiz, hãy thêm hoặc tải từ Sheets trước nhé!");
            return;
        }
        const random = words[Math.floor(Math.random() * words.length)];
        quizBox.style.display = "flex";
        quizQuestion.textContent = `Từ nào trong tiếng Anh có nghĩa: "${random.meaning}" ?`;
        quizAnswer.textContent =
            "Đáp án: " + random.word +
            (random.sentence ? " | Sentence: " + random.sentence : "");
        quizBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
}

// modal events
if (changePwButton) {
    changePwButton.addEventListener("click", openChangePwModal);
}
if (cancelChangePw) {
    cancelChangePw.addEventListener("click", closeChangePwModal);
}
if (changePwModal) {
    changePwModal.addEventListener("click", (e) => {
        if (e.target === changePwModal) {
            closeChangePwModal();
        }
    });
}

// submit đổi mật khẩu
if (changePwForm) {
    changePwForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!currentUser || !currentUser.email) {
            changePwMessage.textContent = "Bạn cần đăng nhập lại.";
            changePwMessage.className = "modal-message error";
            return;
        }

        const oldPw = (oldPwInput.value || "").trim();
        const newPw = (newPwInput.value || "").trim();
        const confirmPw = (confirmPwInput.value || "").trim();

        if (!oldPw || !newPw || !confirmPw) {
            changePwMessage.textContent = "Vui lòng nhập đầy đủ các trường.";
            changePwMessage.className = "modal-message error";
            return;
        }
        if (newPw.length < 4) {
            changePwMessage.textContent = "Mật khẩu mới nên dài ít nhất 4 ký tự.";
            changePwMessage.className = "modal-message error";
            return;
        }
        if (newPw !== confirmPw) {
            changePwMessage.textContent = "Mật khẩu mới nhập lại không khớp.";
            changePwMessage.className = "modal-message error";
            return;
        }

        changePwMessage.textContent = "Đang xử lý...";
        changePwMessage.className = "modal-message";

        try {
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "changePassword",
                    email: currentUser.email,
                    oldPassword: oldPw,
                    newPassword: newPw
                })
            });

            if (!res.ok) {
                const text = await res.text();
                console.error("Change password HTTP error:", res.status, text);
                changePwMessage.textContent = "Lỗi server: " + res.status;
                changePwMessage.className = "modal-message error";
                return;
            }

            const data = await res.json();

            if (data.status === "success") {
                changePwMessage.textContent = "Đổi mật khẩu thành công!";
                changePwMessage.className = "modal-message success";
                // Nếu muốn bắt user login lại thì mở comment dưới:
                // setTimeout(() => {
                //   localStorage.removeItem(USER_STORAGE_KEY);
                //   window.location.href = "login.html";
                // }, 1000);
            } else {
                changePwMessage.textContent = data.message || "Đổi mật khẩu thất bại.";
                changePwMessage.className = "modal-message error";
            }

        } catch (err) {
            console.error("Change password fetch error:", err);
            changePwMessage.textContent = "Không kết nối được tới server.";
            changePwMessage.className = "modal-message error";
        }
    });
}

// ====== INIT ======
(async function init() {
    requireLoginOrRedirect();
    await fetchWordsFromSheet();
    renderWords();
    updateCount();
})();
