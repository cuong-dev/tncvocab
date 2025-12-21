// ===== CONFIG =====
const SHEET_WEB_APP_URL      = "https://script.google.com/macros/s/AKfycbwF4oukVU_5jSvTDq89Fv5wIVlgrdMiihyJeKdiR59P_DwSXVx78QphXcqZNiPYyCF-/exec"; // Web App VocabScript (/exec)
const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycbzGsNgcSExnTA8XVQZ5iJmu7hvjgNYfGw7IU294sV3a1VkmkuN7gQ3AENgLbb1LtOv1/exec"; // Web App LoginScript (/exec)
const USER_STORAGE_KEY       = "vocab_user_profile";
const GEMINI_KEY_STORAGE_KEY = "vocab_gemini_api_key";
const STATUS_CONFIG = [
    { value: "new",      label: "Mới học",        className: "status-new" },
    { value: "learning", label: "Đang học",       className: "status-learning" },
    { value: "review",   label: "Ôn lại",         className: "status-review" },
    { value: "mastered", label: "Thuộc rồi",      className: "status-mastered" },
    // ví dụ thêm status mới:
    // { value: "forgot",   label: "Quên rồi",       className: "status-forgot" },
];
let words = [];
let currentUser = null;
let editingIndex = -1;
let activeFolder = null;      // null = chưa chọn folder
let currentFolderNames = []; 

const PAGE_SIZE = 10;   // mỗi trang 10 từ
let currentPage = 1;

// ===== DOM ELEMENTS =====
const wordForm        = document.getElementById("word-form");
const wordInput       = document.getElementById("word");
const meaningInput    = document.getElementById("meaning");
const folderInput     = document.getElementById("folder");
const folderList      = document.getElementById("folder-list");

const ipaInput        = document.getElementById("ipa");
const typeInput       = document.getElementById("type");
const statusSelect    = document.getElementById("status");
const sentenceInput   = document.getElementById("sentence");

const wordSubmitButton = document.getElementById("word-submit-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const editHint         = document.getElementById("edit-hint");

const wordListEl      = document.getElementById("word-list");
const wordEmptyEl     = document.getElementById("word-empty");
const totalCountPill  = document.getElementById("total-count-pill");
const streakText      = document.getElementById("streak-text");
const folderFilterRow = document.getElementById("folder-filter-row");
const reloadButton    = document.getElementById("reload-button");
const searchInput     = document.getElementById("search-input");

const userDisplay     = document.getElementById("user-display");
const logoutButton    = document.getElementById("logout-button");

// Đổi mật khẩu
const changePwButton  = document.getElementById("change-password-button");
const changePwModal   = document.getElementById("change-password-modal");
const changePwForm    = document.getElementById("change-password-form");
const oldPwInput      = document.getElementById("old-password");
const newPwInput      = document.getElementById("new-password");
const confirmPwInput  = document.getElementById("confirm-password");
const cancelChangePw  = document.getElementById("cancel-change-password");
const changePwMessage = document.getElementById("change-password-message");

// AI modal (spinner)
const aiButton    = document.getElementById("ai-suggest-button");
const aiModal     = document.getElementById("ai-modal");
const aiWordLabel = document.getElementById("ai-word-label");

// Toast
const toastEl = document.getElementById("toast");

// Popup nhập Gemini key
const geminiModal   = document.getElementById("gemini-key-modal");
const geminiForm    = document.getElementById("gemini-key-form");
const geminiInput   = document.getElementById("gemini-key-input");
const geminiCancel  = document.getElementById("cancel-gemini-key");
const geminiMessage = document.getElementById("gemini-key-message");
const paginationEl   = document.getElementById("pagination");
// ===== Toast helper =====
function showToast(message, type = "info") {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = "";
    toastEl.id = "toast";
    toastEl.classList.add(type);
    toastEl.style.opacity = 1;
    toastEl.style.pointerEvents = "auto";
    toastEl.classList.add("show");

    setTimeout(() => {
        toastEl.classList.remove("show");
        toastEl.style.opacity = 0;
        toastEl.style.pointerEvents = "none";
    }, 2500);
}

// ===== LOGIN =====

async function syncAccountStatus() {
    if (!currentUser || !currentUser.email) return;
    try {
        const res = await fetch(LOGIN_API_URL, {
            method: "POST", mode: "cors",
            body: JSON.stringify({ action: "checkStatus", email: currentUser.email })
        });
        const data = await res.json();
        if (data.status === "success") {
            const newExpiry = data.expiryDate;
            const newReg    = data.regDate;
            
            // Cập nhật cả 2 ngày
            currentUser.expiryDate = newExpiry;
            currentUser.regDate    = newReg;
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));

            // Nếu user vừa nạp tiền (Gói trả phí active)
            if (!isPaidExpired()) {
                showToast("🎉 Tài khoản VIP đang hoạt động!", "success");
                updateUserUI_Active();
                closePremiumPopup();
            }
        }
    } catch (err) { console.error(err); }
}
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

        // Nếu profile có geminiKey nhưng localStorage chưa có => sync từ sheet
        if (currentUser.geminiKey && !localStorage.getItem(GEMINI_KEY_STORAGE_KEY)) {
            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, currentUser.geminiKey);
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
    if (currentUser && currentUser.email) {
        // chỉ hiển thị gmail đăng nhập
        userDisplay.textContent = currentUser.email;
    } else {
        userDisplay.textContent = "Khách (chưa đăng nhập)";
    }
}

function updateUserUI_Active() {
    const userPill = document.getElementById("user-display");
    if (userPill) {
        userPill.style.background = ""; // Reset về mặc định
        userPill.style.color = "";
        userPill.style.border = "";
        // Xóa chữ (Hết hạn) nếu có
        userPill.textContent = userPill.textContent.replace(" (Hết hạn)", "");
    }
}

// Cập nhật giao diện lúc vào trang (init)
function updateUI_InitState() {
    if (isPaidExpired()) {
        if (isTrialActive()) {
            // Đang dùng thử
            showToast(`Chào bạn mới! Bạn còn ${getTrialRemainingTime()} dùng thử.`, "info");
        } else {
            // Hết sạch hạn
            showToast("Hết hạn dùng thử. Vui lòng gia hạn.", "error");
            updateUserUI_Expired();
        }
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", () => {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        window.location.href = "login.html";
    });
}

// ===== ĐỔI MẬT KHẨU =====
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

// ===== GEMINI KEY =====
function getGeminiKey() {
    return localStorage.getItem(GEMINI_KEY_STORAGE_KEY) || "";
}
function openGeminiModal() {
    if (!currentUser || !currentUser.email) {
        alert("Bạn cần đăng nhập trước khi thiết lập Gemini key.");
        return;
    }
    geminiMessage.textContent = "";
    geminiMessage.className = "modal-message";
    geminiInput.value = "";
    geminiModal.style.display = "flex";
}
function closeGeminiModal() {
    geminiModal.style.display = "none";
}

// ===== VOCAB FROM SHEET =====
async function fetchWordsFromSheet() {
    if (!currentUser || !currentUser.email) return;

    const url = `${SHEET_WEB_APP_URL}?userEmail=${encodeURIComponent(
        currentUser.email.toLowerCase()
    )}`;

    try {
        const res = await fetch(url, { method: "GET" });
        const data = await res.json();

        if (data.status === "success" && Array.isArray(data.words)) {
            words = data.words.map(w => ({
                rowIndex: w.rowIndex || null,
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
        console.error("Lỗi fetch vocab:", err);
        words = [];
    }
}

// ===== SEND VOCAB TO SHEET =====
function sendWordToGoogleSheet_Add(word) {
    if (!currentUser || !currentUser.email) {
        alert("Chưa đăng nhập, không thể lưu từ.");
        return;
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase(),
        action: "add"
    };

    fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success" && data.rowIndex) {
            const last = words[words.length - 1];
            if (last && last.rowIndex == null) {
                last.rowIndex = data.rowIndex;
            }
            showToast("Đã lưu từ mới lên Google Sheets", "success");
        } else {
            console.warn("Gửi Google Sheets (add) lỗi:", data);
            showToast("Lưu từ mới lên Sheets bị lỗi", "error");
        }
    })
    .catch(err => {
        console.error("POST Sheets add error:", err);
        showToast("Không kết nối được Google Sheets", "error");
    });
}

function sendWordToGoogleSheet_Update(index, word) {
    const item = words[index];
    if (!item || !item.rowIndex) {
        alert("Không tìm được rowIndex để cập nhật. Hãy tải lại danh sách rồi thử lại.");
        return;
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase(),
        action: "update",
        rowIndex: item.rowIndex
    };

    return fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).then(res => res.json());
}

function sendWordToGoogleSheet_Delete(index) {
    const item = words[index];
    if (!item || !item.rowIndex) {
        alert("Không tìm được rowIndex để xóa. Hãy tải lại danh sách rồi thử lại.");
        return Promise.reject("no rowIndex");
    }

    const payload = {
        userEmail: currentUser.email.toLowerCase(),
        action: "delete",
        rowIndex: item.rowIndex
    };

    return fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).then(res => res.json());
}

// ===== UI HELPERS =====

// ✅ Cập nhật: gom folder + tạo chip, có kèm số lượng từ
function updateFolderSuggestions() {
    if (!folderList) return;

    const set = new Set();
    words.forEach(w => {
        if (w.folder && w.folder.trim() !== "") {
            set.add(w.folder.trim());
        }
    });

    const folders = Array.from(set).sort((a, b) => a.localeCompare(b));
    currentFolderNames = folders;

    // datalist cho ô input Folder
    folderList.innerHTML = "";
    folders.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        folderList.appendChild(opt);
    });

    // chip filter
    renderFolderFilters();
}

// ✅ Cập nhật: chip có số lượng, click chip mới renderWords
function renderFolderFilters() {
    if (!folderFilterRow) return;

    folderFilterRow.innerHTML = "";

    // 1. Tính toán số lượng
    const counts = {};
    let noFolderCount = 0; // Đếm số từ chưa có folder
    let totalCount = words.length;

    words.forEach(w => {
        const f = (w.folder || "").trim();
        if (!f) {
            noFolderCount++;
        } else {
            counts[f] = (counts[f] || 0) + 1;
        }
    });

    // 2. Nút "Tất cả"
    const allLabel = `Tất cả (${totalCount})`;
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = allLabel;
    allBtn.className = "folder-pill" + (activeFolder === "ALL" || activeFolder === null ? " active" : ""); 
    // Mặc định activeFolder là 'ALL' hoặc null thì sáng nút này
    
    allBtn.addEventListener("click", () => {
        activeFolder = "ALL";
        currentPage = 1;
        renderFolderFilters();
        renderWords(searchInput.value);
    });
    folderFilterRow.appendChild(allBtn);

    // 3. Nút "Chưa phân loại" (Chỉ hiện nếu có từ)
    if (noFolderCount > 0) {
        const noFolderBtn = document.createElement("button");
        noFolderBtn.type = "button";
        noFolderBtn.innerHTML = `📂 Chưa phân loại (${noFolderCount})`; // Dùng icon cho dễ nhìn
        noFolderBtn.className = "folder-pill" + (activeFolder === "_NO_FOLDER_" ? " active" : "");
        
        noFolderBtn.addEventListener("click", () => {
            activeFolder = "_NO_FOLDER_"; // Đặt mã đặc biệt
            currentPage = 1;
            renderFolderFilters();
            renderWords(searchInput.value);
        });
        folderFilterRow.appendChild(noFolderBtn);
    }

    // 4. Các nút Folder khác
    currentFolderNames.forEach(folderName => {
        const count = counts[folderName] || 0;
        const label = `${folderName} (${count})`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "folder-pill" + (activeFolder === folderName ? " active" : "");
        btn.addEventListener("click", () => {
            activeFolder = folderName;
            currentPage = 1;
            renderFolderFilters();
            renderWords(searchInput.value);
        });
        folderFilterRow.appendChild(btn);
    });
}

function renderPagination(totalPages, totalItems) {
    if (!paginationEl) return;

    paginationEl.innerHTML = "";

    if (totalPages <= 1) {
        return; // không cần phân trang
    }

    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Trang ${currentPage}/${totalPages} – ${totalItems} từ`;
    paginationEl.appendChild(info);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "‹";
    prevBtn.className = "page-btn";
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderWords(searchInput.value);
        }
    });
    paginationEl.appendChild(prevBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "›";
    nextBtn.className = "page-btn";
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.addEventListener("click", () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderWords(searchInput.value);
        }
    });
    paginationEl.appendChild(nextBtn);
}

function renderUserStatus() {
    const userPill = document.getElementById("user-display");
    if (!userPill || !currentUser) return;

    let tagHtml = "";
    let borderColor = "#e5e7eb"; // Màu viền mặc định của nút User

    // LOGIC XÁC ĐỊNH TRẠNG THÁI
    if (!isPaidExpired()) {
        tagHtml = `<span class="status-tag tag-active">VIP</span>`; // Viết tắt cho gọn
        borderColor = "#10b981"; 
        userPill.style.background = "#f0fdf4"; // Nền xanh rất nhạt
    } else if (isTrialActive()) {
        tagHtml = `<span class="status-tag tag-trial">Trial</span>`; // Viết tắt
        borderColor = "#f59e0b"; 
        userPill.style.background = "#fffbeb"; 
    } else {
        tagHtml = `<span class="status-tag tag-expired">Hết Hạn</span>`; // Viết tắt
        borderColor = "#ef4444"; 
        userPill.style.background = "#fef2f2";
    }

    // Hiển thị: Icon + Tên + Tag
    // (currentUser.name ưu tiên, nếu không có lấy email)
    const displayName = currentUser.email ? currentUser.email.split('@')[0] : "User";

    userPill.innerHTML = `
        <span style="font-size:16px;">👤</span> 
        <span class="user-name-text" title="${displayName}">${displayName}</span> 
        ${tagHtml}
    `;
    userPill.style.border = `1px solid ${borderColor}`;
}

function getTypeTagClass(type) {
    if (!type) return "tag-other";
    const t = type.toLowerCase();
    if (t.includes("noun")) return "tag-A1";
    if (t.includes("verb")) return "tag-A2";
    if (t.includes("adj"))  return "tag-B1";
    if (t.includes("adv"))  return "tag-B2";
    if (t.includes("phrase")) return "tag-C1";
    return "tag-other";
}
function getStatusClass(status) {
    const st = STATUS_CONFIG.find(s => s.value === status);
    return st ? st.className : "status-new";
}

function updateCount() {
    if (!totalCountPill) return;
    const span = totalCountPill.querySelector("span:last-child");
    if (span) span.textContent = words.length + " từ";
}

// streak
function computeStreakDays(wordsArray) {
    let earliest = null;

    for (const w of wordsArray) {
        if (!w.dateAdded) continue;

        const d = new Date(w.dateAdded);
        if (isNaN(d.getTime())) continue;

        if (!earliest || d < earliest) {
            earliest = d;
        }
    }

    if (!earliest) return 0;

    const today = new Date();

    const start = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
    const end   = new Date(today.getFullYear(),   today.getMonth(),   today.getDate());

    const diffMs   = end - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

    return Math.max(diffDays, 1);
}

function updateStreak() {
    if (!streakText) return;

    const days = computeStreakDays(words);
    let label;
    if (days <= 0) label = "0 ngày";
    else if (days === 1) label = "1 ngày";
    else label = days + " ngày";

    streakText.innerHTML = `Chuỗi ngày học: <b>${label}</b>`;
}

// Speech
function playPronunciation(text) {
    if (!text) return;
    if (!("speechSynthesis" in window)) {
        alert("Trình duyệt không hỗ trợ phát âm.");
        return;
    }
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = "en-US";
    utter.rate  = 0.95;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
}

// Edit mode
function setEditMode(index) {
    editingIndex = index;
    if (index < 0) {
        if (wordSubmitButton) wordSubmitButton.textContent = "+ Thêm vào Google Sheets";
        if (cancelEditButton) cancelEditButton.style.display = "none";
        if (editHint)         editHint.style.display = "none";

        wordInput.value     = "";
        meaningInput.value  = "";
        folderInput.value   = "";
        ipaInput.value      = "";
        typeInput.value     = "";
        sentenceInput.value = "";
        statusSelect.value  = "new";
        return;
    }

    const w = words[index];
    if (!w) return;

    wordInput.value     = w.word || "";
    meaningInput.value  = w.meaning || "";
    folderInput.value   = w.folder || "";
    ipaInput.value      = w.ipa || "";
    typeInput.value     = w.type || "";
    sentenceInput.value = w.sentence || "";
    statusSelect.value  = w.status || "new";

    if (wordSubmitButton) wordSubmitButton.textContent = "💾 Lưu thay đổi";
    if (cancelEditButton) cancelEditButton.style.display = "inline-flex";
    if (editHint) {
        editHint.style.display = "inline";
        editHint.textContent   = `Đang sửa từ: "${w.word}"`;
    }
}

// ✅ Render list có lọc folder + search, và ẩn khi chưa chọn folder
function renderWords(filterText = "") {
    const rows = Array.from(wordListEl.querySelectorAll(".word-row"));
    rows.forEach((row, index) => {
        if (index === 0) return;
        row.remove();
    });

    // Mặc định ban đầu vào là chọn ALL luôn cho người dùng dễ thấy
    if (activeFolder === null) activeFolder = "ALL";

    const text = (filterText || "").trim().toLowerCase();

    // 1. Lọc dữ liệu
    const filtered = [];
    words.forEach((w, index) => {
        const f = (w.folder || "").trim();

        // --- Logic lọc folder mới ---
        if (activeFolder !== "ALL") {
            if (activeFolder === "_NO_FOLDER_") {
                // Nếu đang chọn "Chưa phân loại", chỉ lấy từ ko có folder
                if (f !== "") return; 
            } else {
                // Nếu chọn folder thường, phải khớp tên
                if (f !== activeFolder) return;
            }
        }

        // Lọc theo search input
        if (text) {
            const match = (
                (w.word || "")   + " " +
                (w.meaning || "")+ " " +
                (w.folder || "")
            ).toLowerCase().includes(text);
            if (!match) return;
        }

        filtered.push({ w, index });
    });

    const totalItems = filtered.length;

    if (totalItems === 0) {
        wordEmptyEl.style.display = "block";
        if (activeFolder === "_NO_FOLDER_") {
            wordEmptyEl.textContent = "Bạn đã phân loại hết các từ rồi! (Không có từ nào chưa có folder)";
        } else {
            wordEmptyEl.textContent = "Không có từ nào trong mục này.";
        }
        if (paginationEl) paginationEl.innerHTML = "";
        return;
    } else {
        wordEmptyEl.style.display = "none";
    }

    // 2. Phân trang & Render (Giữ nguyên logic cũ)
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const end   = start + PAGE_SIZE;
    const pageItems = filtered.slice(start, end);

    pageItems.forEach(({ w, index }) => {
        const row = document.createElement("div");
        row.className = "word-row";

        // ... Tạo các cột (Word, IPA, Meaning...) - Code phần này giữ nguyên như cũ ...
        // (Để tiết kiệm không gian chat, bạn giữ nguyên phần tạo HTML bên trong vòng lặp này nhé)
        // Chỉ cần copy đoạn tạo row cũ paste vào đây
        
        const wordCell = document.createElement("div");
        wordCell.textContent = w.word;

        const ipaCell = document.createElement("div");
        ipaCell.textContent = w.ipa || "—";

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
        folderCell.textContent = w.folder || "—"; // Hiển thị dấu gạch nếu ko có folder

        const statusCell = document.createElement("div");
        const statusSpan = document.createElement("span");
        statusSpan.className = "status-pill " + getStatusClass(w.status);
        statusSpan.textContent = w.status || "new";
        statusCell.appendChild(statusSpan);

        const actionsCell = document.createElement("div");
        actionsCell.className = "word-actions";

        // Các nút Sound, Edit, Delete
        const soundBtn = document.createElement("button");
        soundBtn.type = "button";
        soundBtn.textContent = "🔊";
        soundBtn.className = "mini-btn voice";
        soundBtn.addEventListener("click", () => playPronunciation(w.word));

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "Sửa";
        editBtn.className = "mini-btn edit";
        editBtn.addEventListener("click", ()  => {
            if (!checkAccess()) return; // <--- Chặn
                setEditMode(index);
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "Xóa";
        delBtn.className = "mini-btn delete";
        delBtn.addEventListener("click", async () => {
            if (!checkAccess()) return;
             if (!confirm(`Xóa từ "${w.word}"?`)) return;
             try {
                const data = await sendWordToGoogleSheet_Delete(index);
                if (data && data.status === "success") {
                    words.splice(index, 1);
                    renderWords(searchInput.value);
                    updateCount();
                    if (editingIndex === index) setEditMode(-1);
                    updateFolderSuggestions(); 
                    showToast("Đã xóa từ", "success");
                } else {
                    showToast("Xóa thất bại", "error");
                }
            } catch (err) {
                console.error(err);
                showToast("Lỗi kết nối", "error");
            }
        });

        actionsCell.appendChild(soundBtn);
        actionsCell.appendChild(editBtn);
        actionsCell.appendChild(delBtn);

        row.appendChild(wordCell);
        row.appendChild(ipaCell);
        row.appendChild(meaningCell);
        row.appendChild(sentenceCell);
        row.appendChild(typeCell);
        row.appendChild(folderCell);
        row.appendChild(statusCell);
        row.appendChild(actionsCell);

        wordListEl.appendChild(row);
    });

    renderPagination(totalPages, totalItems);
}

// ===== AI – GỌI GEMINI =====
async function aiGenerateWordData(word) {
    const key = getGeminiKey();
    if (!key) throw new Error("NO_GEMINI_KEY");

    const prompt = `
Bạn là trợ lý tạo từ vựng tiếng Anh cho người Việt.
Cho từ: "${word}"

Hãy trả về đúng JSON, KHÔNG có text nào ngoài JSON:

{
  "ipa": "phiên âm IPA",
  "type": "noun/verb/adj/adv/phrase",
  "meaning": "nghĩa tiếng Việt ngắn gọn",
  "sentence": "1 câu ví dụ đơn giản",
  "status": "new"
}
`;

    const body = { contents: [ { parts: [ { text: prompt } ] } ] };

    const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-robotics-er-1.5-preview:generateContent?key=" + encodeURIComponent(key),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }
    );

    if (!res.ok) {
        throw new Error("Gemini HTTP " + res.status);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
        console.error("AI response:", text);
        throw new Error("AI không trả về JSON hợp lệ");
    }

    const jsonStr = text.slice(start, end + 1);
    return JSON.parse(jsonStr);
}

// Test key có kết nối được server không
async function testGeminiKey(key) {
    const body = {
        contents: [
            { parts: [ { text: "ping" } ] }
        ]
    };

    const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }
    );

    if (!res.ok) {
        throw new Error("Gemini HTTP " + res.status);
    }

    const data = await res.json();
    if (!data.candidates || !data.candidates.length) {
        throw new Error("Gemini không trả về candidates");
    }
    // nếu tới đây là coi như key dùng được
}

// AI modal spinner
function openAiModal(word) {
    if (!aiModal) return;
    if (aiWordLabel) aiWordLabel.textContent = `Từ: "${word}"`;
    aiModal.style.display = "flex";
}
function closeAiModal() {
    if (!aiModal) return;
    aiModal.style.display = "none";
}

// ===== EVENTS =====
if (wordForm) {
    wordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!checkAccess()) return;
        const word     = (wordInput.value || "").trim();
        const meaning  = (meaningInput.value || "").trim();
        const folder   = (folderInput.value || "").trim();
        const ipa      = (ipaInput.value || "").trim();
        const type     = (typeInput.value || "").trim();
        const status   = statusSelect.value || "new";
        const sentence = (sentenceInput.value || "").trim();

        if (!word || !meaning) return;

        const newWord = { word, meaning, folder, ipa, type, sentence, status };

        if (editingIndex < 0) {
            const now = new Date();
            const localDate = now.toISOString().slice(0, 10); // yyyy-MM-dd

            words.push({
                rowIndex : null,
                ...newWord,
                dateAdded: localDate   // dùng để tính streak tạm thời
            });
            renderWords(searchInput.value);
            updateCount();
            updateStreak();
            updateFolderSuggestions();
            sendWordToGoogleSheet_Add(newWord);
            setEditMode(-1);
        } else {
            try {
                const data = await sendWordToGoogleSheet_Update(editingIndex, newWord);
                if (data && data.status === "success") {
                    const old = words[editingIndex];
                    words[editingIndex] = { ...old, ...newWord };
                    renderWords(searchInput.value);
                    setEditMode(-1);
                    updateFolderSuggestions();
                    showToast("Đã cập nhật từ trên Sheets", "success");
                } else {
                    alert(data && data.message ? data.message : "Cập nhật thất bại");
                    showToast("Cập nhật từ thất bại", "error");
                }
            } catch (err) {
                console.error("Update error:", err);
                alert("Lỗi khi cập nhật từ.");
                showToast("Lỗi khi cập nhật từ", "error");
            }
        }
    });
}

if (cancelEditButton) {
    cancelEditButton.addEventListener("click", () => {
        setEditMode(-1);
    });
}

if (reloadButton) {
    reloadButton.addEventListener("click", async () => {
        if (!checkAccess()) return;
        await fetchWordsFromSheet();
        renderWords(searchInput.value);
        updateCount();
        updateStreak();
        updateFolderSuggestions();
        setEditMode(-1);
        showToast("Đã tải lại từ Google Sheets", "info");
    });
}

if (searchInput) {
    searchInput.addEventListener("input", e => {
        currentPage = 1;                  // reset về trang đầu
        renderWords(e.target.value);
    });
}

// Đổi mật khẩu events
if (changePwButton) {
    changePwButton.addEventListener("click", openChangePwModal);
}
if (cancelChangePw) {
    cancelChangePw.addEventListener("click", closeChangePwModal);
}
if (changePwModal) {
    changePwModal.addEventListener("click", e => {
        if (e.target === changePwModal) closeChangePwModal();
    });
}
if (changePwForm) {
    changePwForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!currentUser || !currentUser.email) {
            changePwMessage.textContent = "Bạn cần đăng nhập lại.";
            changePwMessage.className = "modal-message error";
            return;
        }

        const oldPw     = (oldPwInput.value || "").trim();
        const newPw     = (newPwInput.value || "").trim();
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
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
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

// Gemini key events
if (geminiCancel) {
    geminiCancel.addEventListener("click", closeGeminiModal);
}
if (geminiModal) {
    geminiModal.addEventListener("click", e => {
        if (e.target === geminiModal) closeGeminiModal();
    });
}
if (geminiForm) {
    geminiForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!currentUser || !currentUser.email) {
            geminiMessage.textContent = "Bạn cần đăng nhập lại.";
            geminiMessage.className = "modal-message error";
            return;
        }

        const key = (geminiInput.value || "").trim();
        if (!key) {
            geminiMessage.textContent = "Vui lòng nhập Gemini API key.";
            geminiMessage.className = "modal-message error";
            return;
        }

        geminiMessage.textContent = "Đang kiểm tra key với Gemini server...";
        geminiMessage.className = "modal-message";

        try {
            await testGeminiKey(key);

            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, key);

            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "saveGeminiKey",
                    email : currentUser.email,
                    key   : key
                })
            });

            let data = null;
            if (res.ok) {
                data = await res.json();
            } else {
                const txt = await res.text();
                console.error("saveGeminiKey HTTP error:", res.status, txt);
            }

            if (data && data.status === "success") {
                currentUser.geminiKey = key;
                localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));

                geminiMessage.textContent = "Key hợp lệ! Đã lưu cho tài khoản này.";
                geminiMessage.className   = "modal-message success";
                showToast("Lưu Gemini key thành công", "success");
                setTimeout(closeGeminiModal, 800);
            } else {
                geminiMessage.textContent = (data && data.message) || "Lưu key lên sheet bị lỗi (nhưng key vẫn dùng được).";
                geminiMessage.className   = "modal-message error";
                showToast("Lưu key lên sheet bị lỗi", "error");
            }

        } catch (err) {
            console.error("Gemini key error:", err);
            geminiMessage.textContent = "Key không kết nối được với Gemini: " + err.message;
            geminiMessage.className   = "modal-message error";
            showToast("Gemini key không kết nối được server", "error");
        }
    });
}

// AI button
if (aiButton) {
    aiButton.addEventListener("click", async () => {
        if (!checkAccess()) return;
        const word = (wordInput.value || "").trim();
        if (!word) {
            alert("Hãy nhập Word trước khi dùng AI gợi ý.");
            return;
        }

        if (!getGeminiKey()) {
            showToast("Bạn chưa thiết lập Gemini API key", "info");
            openGeminiModal();
            return;
        }

        aiButton.disabled = true;
        aiButton.textContent = "⏳ AI đang nghĩ...";
        openAiModal(word);

        try {
            const aiData = await aiGenerateWordData(word);

            ipaInput.value      = aiData.ipa      || "";
            typeInput.value     = aiData.type     || "";
            meaningInput.value  = aiData.meaning  || "";
            sentenceInput.value = aiData.sentence || "";
            statusSelect.value  = aiData.status   || "new";

            showToast("AI đã gợi ý nội dung cho từ", "success");
        } catch (err) {
            console.error("AI error:", err);
            if (err.message === "NO_GEMINI_KEY") {
                showToast("Chưa có Gemini key", "error");
                openGeminiModal();
            } else {
                alert("AI lỗi: " + err.message);
                showToast("AI gợi ý thất bại", "error");
            }
        } finally {
            closeAiModal();
            aiButton.disabled = false;
            aiButton.textContent = "🤖 AI gợi ý nội dung";
        }
    });
}

// ==========================================
// REVIEW SYSTEM LOGIC (ĐỘC LẬP HOÀN TOÀN)
// ==========================================

let reviewList = [];       // Danh sách từ để ôn
let currentReviewIdx = 0;  // Vị trí hiện tại
let pendingMode = "";      // Lưu tạm chế độ đang chọn (flashcard/fill)

// 1. Điều hướng Tab
function showSection(sectionId) {
    
    const vocabSection = document.querySelector('section.card:nth-of-type(1)'); 
    const listSection  = document.querySelector('section.card:nth-of-type(2)');
    const reviewSection = document.getElementById('review-section');
    const irregularSection = document.getElementById('irregular-section'); // <--- MỚI

    // Reset nút active
    document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));

    // Ẩn tất cả
    if (vocabSection) vocabSection.style.display = 'none';
    if (listSection) listSection.style.display = 'none';
    if (reviewSection) reviewSection.style.display = 'none';
    if (irregularSection) irregularSection.style.display = 'none';

    // Hiện tab được chọn
    if (sectionId === 'vocab') {
        if (vocabSection) vocabSection.style.display = 'block';
        if (listSection) listSection.style.display = 'block';
        document.querySelector('button[onclick="showSection(\'vocab\')"]').classList.add('active');
    } 
    else if (sectionId === 'review') {
        if (reviewSection) reviewSection.style.display = 'block';
        document.querySelector('button[onclick="showSection(\'review\')"]').classList.add('active');
        backToReviewMenu();
    }
    else if (sectionId === 'irregular') {
       if (irregularSection) irregularSection.style.display = 'block';
        document.querySelector('button[onclick="showSection(\'irregular\')"]').classList.add('active');
        
        // MỚI: Tự động tải dữ liệu từ Sheet khi bấm vào tab này lần đầu
        fetchIrregularVerbsFromSheet(); 
        
        // Focus vào ô tìm kiếm cho tiện
        setTimeout(() => document.getElementById("irregular-search-input").focus(), 300);
    }
}

// 2. Navigation trong Review
function backToReviewFolder() {
    // Ẩn 3 game
    const flashcardEl = document.getElementById('mode-flashcard');
    const fillEl      = document.getElementById('mode-fill');
    const scrambleEl  = document.getElementById('mode-scramble'); // <-- Bổ sung cái này

    if (flashcardEl) flashcardEl.style.display = 'none';
    if (fillEl)      fillEl.style.display = 'none';
    if (scrambleEl)  scrambleEl.style.display = 'none';

    // Hiện lại màn chọn folder
    document.getElementById('review-folder-selection').style.display = 'block';
}

// Quay lại Menu chính của phần Ôn tập
function backToReviewMenu() {
    const menuEl      = document.getElementById('review-menu');
    const folderSelEl = document.getElementById('review-folder-selection');
    
    // Ẩn hết game + màn chọn folder
    const flashcardEl = document.getElementById('mode-flashcard');
    const fillEl      = document.getElementById('mode-fill');
    const scrambleEl  = document.getElementById('mode-scramble'); // <-- Bổ sung

    if (folderSelEl) folderSelEl.style.display = 'none';
    if (flashcardEl) flashcardEl.style.display = 'none';
    if (fillEl)      fillEl.style.display = 'none';
    if (scrambleEl)  scrambleEl.style.display = 'none';

    // Hiện menu
    if (menuEl) menuEl.style.display = 'block';
}

// 3. Bước 1: Chọn Game -> Hiện màn hình chọn Folder
function startReviewSetup(mode) {
    
     if (!checkAccess()) return; // <--- Bấm vào tab Ôn tập là hiện Popup đòi tiền
    
    if (words.length === 0) {
        alert("Chưa có từ vựng nào để ôn tập!");
        return;
    }
    

    pendingMode = mode; 

    // Ẩn menu, hiện màn hình chọn folder
    document.getElementById('review-menu').style.display = 'none';
    document.getElementById('review-folder-selection').style.display = 'block';

    const selectEl = document.getElementById('review-folder-select');
    selectEl.innerHTML = "";

    // --- LOGIC MỚI: Đếm folder & từ chưa phân loại ---
    const folderCounts = {};
    let noFolderCount = 0; // Biến đếm từ không có folder

    words.forEach(w => {
        const f = (w.folder || "").trim();
        if (!f) {
            noFolderCount++; // Tăng đếm nếu không có folder
        } else {
            folderCounts[f] = (folderCounts[f] || 0) + 1;
        }
    });

    // Option 1: Tất cả
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = `Tất cả (${words.length} từ)`;
    selectEl.appendChild(allOpt);

    // Option 2: Chưa phân loại (Chỉ hiện nếu có từ)
    if (noFolderCount > 0) {
        const noFolderOpt = document.createElement("option");
        noFolderOpt.value = "_NO_FOLDER_"; // Giá trị đặc biệt để nhận biết
        noFolderOpt.textContent = `📂 Chưa phân loại (${noFolderCount} từ)`;
        noFolderOpt.style.fontStyle = "italic";
        selectEl.appendChild(noFolderOpt);
    }

    // Option 3: Các folder khác (Sắp xếp A-Z)
    Object.keys(folderCounts).sort().forEach(folderName => {
        const opt = document.createElement("option");
        opt.value = folderName;
        opt.textContent = `${folderName} (${folderCounts[folderName]} từ)`;
        selectEl.appendChild(opt);
    });
}

// 4. Bước 2: Bấm "Bắt đầu ngay" -> Vào Game
function confirmStartGame() {
    const selectEl = document.getElementById('review-folder-select');
    const selectedFolder = selectEl.value;

    reviewList = [];

    // --- LOGIC MỚI: Xử lý lọc danh sách ---
    if (selectedFolder === "ALL") {
        // Lấy hết
        reviewList = [...words];
    } 
    else if (selectedFolder === "_NO_FOLDER_") {
        // Lấy những từ folder rỗng
        reviewList = words.filter(w => !(w.folder || "").trim());
    } 
    else {
        // Lấy theo tên folder cụ thể
        reviewList = words.filter(w => (w.folder || "").trim() === selectedFolder);
    }

    if (reviewList.length === 0) {
        alert("Danh sách trống!");
        return;
    }

    // Xáo trộn danh sách
    reviewList.sort(() => Math.random() - 0.5);
    currentReviewIdx = 0;

    // Ẩn màn chọn folder -> Hiện game
    document.getElementById('review-folder-selection').style.display = 'none';

    if (pendingMode === 'flashcard') {
        document.getElementById('mode-flashcard').style.display = 'block';
        renderFlashcard();
    } else if (pendingMode === 'fill') {
        document.getElementById('mode-fill').style.display = 'block';
        renderFillQuestion();
    }
    else if (pendingMode === 'scramble') {
        document.getElementById('mode-scramble').style.display = 'block';
        renderScrambleGame();
    }
}
// 5. Logic Game: Flashcard
function renderFlashcard() {
    const w = reviewList[currentReviewIdx];
    const cardEl = document.getElementById('flashcard-el');
    
    // Reset về mặt trước
    cardEl.classList.remove('is-flipped');
    
    setTimeout(() => {
        document.getElementById('fc-word').textContent = w.word;
        document.getElementById('fc-ipa').textContent = w.ipa || "";
        document.getElementById('fc-meaning').textContent = w.meaning;
        document.getElementById('fc-sentence').textContent = w.sentence || "(Chưa có ví dụ)";
        document.getElementById('fc-progress').textContent = `${currentReviewIdx + 1} / ${reviewList.length}`;
    }, 200);
}

function flipCard() {
    document.getElementById('flashcard-el').classList.toggle('is-flipped');
}

function nextFlashcard() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderFlashcard();
    } else {
        // THAY ALERT CŨ BẰNG HÀM MỚI
        showCelebration(); 
    }
}

function prevFlashcard() {
    if (currentReviewIdx > 0) {
        currentReviewIdx--;
        renderFlashcard();
    }
}

// 6. Logic Game: Fill in blank
function renderFillQuestion() {
    const w = reviewList[currentReviewIdx];
    
    document.getElementById('fill-meaning').textContent = w.meaning;
    document.getElementById('fill-folder').textContent = w.folder || "Chung";
    
    const input = document.getElementById('fill-input');
    input.value = "";
    input.disabled = false;
    input.focus();
    
    const feedback = document.getElementById('fill-feedback');
    feedback.textContent = "";
    feedback.className = "feedback-msg";
}

function checkFillAnswer() {
    const w = reviewList[currentReviewIdx];
    const input = document.getElementById('fill-input');
    const userVal = input.value.trim().toLowerCase();
    const correctVal = w.word.trim().toLowerCase();
    const feedback = document.getElementById('fill-feedback');

    if (!userVal) return;

    if (userVal === correctVal) {
        feedback.textContent = "🎉 Chính xác! " + w.word;
        feedback.className = "feedback-msg correct";
        input.disabled = true;
        playPronunciation(w.word); 
    } else {
        feedback.textContent = `Sai rồi. Đáp án đúng: ${w.word}`;
        feedback.className = "feedback-msg wrong";
    }
}

function nextFillQuestion() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderFillQuestion();
    } else {
        // THAY ALERT CŨ BẰNG HÀM MỚI
        showCelebration();
    }
}

// Hỗ trợ nhấn Enter
const fillEl = document.getElementById('fill-input');
if (fillEl) {
    fillEl.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            checkFillAnswer();
        }
    });
}

// ==========================================
// SCRAMBLE GAME LOGIC (SẮP XẾP CHỮ)
// ==========================================
let scrambleCurrentAnswer = []; // Mảng lưu các ký tự người dùng đã xếp
let scrambleOriginChars = [];   // Mảng lưu ký tự gốc (đã xáo trộn) để render Pool

function renderScrambleGame() {
    const w = reviewList[currentReviewIdx];
    document.getElementById('scramble-meaning').textContent = w.meaning;

    const feedback = document.getElementById('scramble-feedback');
    feedback.textContent = "";
    feedback.className = "feedback-msg";
    document.getElementById('scramble-answer-zone').className = "scramble-slots";

    // 1. Chuẩn bị từ vựng: Xóa khoảng trắng, đưa về chữ hoa
    const cleanWord = w.word.replace(/\s+/g, '').toUpperCase();
    
    // 2. Tạo mảng ký tự và xáo trộn
    // Mẹo: map về object có id để phân biệt các chữ cái giống nhau (vd: 2 chữ P trong APPLE)
    scrambleOriginChars = cleanWord.split('').map((char, index) => ({
        id: index,
        char: char
    }));
    
    // Xáo trộn (Shuffle)
    scrambleOriginChars.sort(() => Math.random() - 0.5);

    scrambleCurrentAnswer = []; // Reset câu trả lời
    renderScrambleUI();
}

function renderScrambleUI() {
    const poolEl = document.getElementById('scramble-pool');
    const answerEl = document.getElementById('scramble-answer-zone');
    
    poolEl.innerHTML = "";
    answerEl.innerHTML = "";

    // Render Pool (Các chữ cái bên dưới)
    scrambleOriginChars.forEach(item => {
        const btn = document.createElement("div");
        btn.className = "letter-tile";
        btn.textContent = item.char;
        
        // Kiểm tra xem ký tự này đã được chọn lên trên chưa
        const isSelected = scrambleCurrentAnswer.find(a => a.id === item.id);
        if (isSelected) {
            btn.classList.add("used"); // Ẩn đi nếu đã chọn
        } else {
            // Sự kiện: Bấm vào Pool -> Bay lên Answer
            btn.onclick = () => {
                scrambleCurrentAnswer.push(item);
                renderScrambleUI(); // Vẽ lại
            };
        }
        poolEl.appendChild(btn);
    });

    // Render Answer Zone (Các chữ cái đã chọn)
    scrambleCurrentAnswer.forEach((item, index) => {
        const btn = document.createElement("div");
        btn.className = "letter-tile";
        btn.textContent = item.char;
        
        // Sự kiện: Bấm vào Answer -> Trả về Pool
        btn.onclick = () => {
            scrambleCurrentAnswer.splice(index, 1); // Xóa khỏi answer
            renderScrambleUI(); // Vẽ lại
        };
        answerEl.appendChild(btn);
    });
}

function resetScramble() {
    scrambleCurrentAnswer = [];
    renderScrambleUI();
    document.getElementById('scramble-feedback').textContent = "";
    document.getElementById('scramble-answer-zone').className = "scramble-slots";
}

function checkScrambleAnswer() {
    const w = reviewList[currentReviewIdx];
    const cleanWord = w.word.replace(/\s+/g, '').toUpperCase();
    
    // Ghép các ký tự user chọn thành chuỗi
    const userAnswer = scrambleCurrentAnswer.map(i => i.char).join('');
    const feedback = document.getElementById('scramble-feedback');
    const zone = document.getElementById('scramble-answer-zone');

    if (userAnswer === cleanWord) {
        feedback.textContent = "🎉 Chính xác! " + w.word;
        feedback.className = "feedback-msg correct";
        zone.classList.add("correct");
        playPronunciation(w.word);
    } else {
        feedback.textContent = "Sai rồi, thử lại nhé!";
        feedback.className = "feedback-msg wrong";
        zone.classList.add("wrong");
        // Hiệu ứng rung nhẹ nếu muốn (optional)
        setTimeout(() => zone.classList.remove("wrong"), 500);
    }
}

function nextScrambleQuestion() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderScrambleGame();
    } else {
        showCelebration(); // Gọi hiệu ứng pháo giấy chiến thắng
    }
}

// ==========================================
// LOGIC DÙNG THỬ 24H & CHECK QUYỀN
// ==========================================

// Hàm kiểm tra xem tài khoản CHÍNH THỨC có hết hạn không
function isPaidExpired() {
    if (!currentUser) return true;
    const expiryStr = currentUser.expiryDate;
    
    // Nếu không có ngày hạn -> Coi như chưa kích hoạt gói trả phí
    if (!expiryStr || expiryStr.trim() === "") return true;

    const expiryDate = new Date(expiryStr);
    const now = new Date();
    expiryDate.setHours(23, 59, 59, 999);
    
    return now > expiryDate;
}

// Hàm kiểm tra xem có còn trong thời gian DÙNG THỬ (24h) không
function isTrialActive() {
    if (!currentUser || !currentUser.regDate) return false;

    const regDate = new Date(currentUser.regDate);
    const now = new Date();
    
    // Tính thời điểm hết hạn dùng thử (Ngày đăng ký + 24 giờ)
    const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
    
    // Nếu hiện tại vẫn nhỏ hơn thời điểm hết trial -> Còn dùng được
    return now < trialEndTime;
}

// Hàm tính thời gian còn lại (để hiển thị cho user sướng)
function getTrialRemainingTime() {
    if (!currentUser.regDate) return "";
    const regDate = new Date(currentUser.regDate);
    const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
    const now = new Date();
    
    const diffMs = trialEndTime - now;
    if (diffMs <= 0) return "0 giờ";
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} giờ ${minutes} phút`;
}

function isExpired() {
    if (!currentUser) return true;
    const expiryStr = currentUser.expiryDate;
    
    // Nếu không có ngày hạn => Coi như hết hạn
    if (!expiryStr || expiryStr.trim() === "") return true;

    const expiryDate = new Date(expiryStr);
    const now = new Date();
    expiryDate.setHours(23, 59, 59, 999); 
    
    return now > expiryDate;
}

// Hàm hiển thị Popup bán hàng
function showPremiumPopup() {
    const modal = document.getElementById("premium-modal");
    if (modal) modal.style.display = "flex";
}

// Hàm đóng Popup
function closePremiumPopup() {
    const modal = document.getElementById("premium-modal");
    if (modal) modal.style.display = "none";
}

// Hàm Wrapper: Kiểm tra quyền trước khi thực hiện hành động
function checkAccess() {
    if (!isPaidExpired()) {
        return true; 
    }

    // 2. Nếu không, kiểm tra gói Dùng thử
    if (isTrialActive()) {
        const remaining = getTrialRemainingTime();
        // Hiện thông báo nhẹ mỗi lần dùng để nhắc khéo
        showToast(`⚡ Dùng thử miễn phí: Còn ${remaining}`, "warning");
        return true; // Cho qua
    }

    // 3. Hết cả trả phí lẫn dùng thử -> CHẶN
    showPremiumPopup();
    return false;
}

// Hàm phụ trợ logout nhanh
function forceLogout(msg) {
    alert(msg);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    window.location.href = "login.html";
}

// ==========================================
// HIỆU ỨNG CHIẾN THẮNG (CONFETTI)
// ==========================================

function showCelebration() {
    // 1. Phát nhạc (nếu trình duyệt cho phép) - Tuỳ chọn
    // const audio = new Audio('path/to/success.mp3'); audio.play().catch(()=>{});

    // 2. Hiện Modal
    const modal = document.getElementById("celebration-modal");
    const countEl = document.getElementById("celebration-count");
    
    if (countEl) countEl.textContent = reviewList.length;
    
    if (modal) {
        modal.style.display = "flex";
        modal.classList.add("show");
    }

    // 3. Bắn pháo giấy
    fireConfetti();
}

function closeCelebration() {
    const modal = document.getElementById("celebration-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("show");
    }
    // Quay về menu chọn folder
    backToReviewFolder();
}

// --- Logic vẽ Confetti (Gọn nhẹ, không cần thư viện ngoài) ---
function fireConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    if (!canvas) return;
    
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const mp = 150; // Số lượng hạt
    const particles = [];
    for (let i = 0; i < mp; i++) {
        particles.push({
            x: Math.random() * W,
            y: Math.random() * H - H,
            r: Math.random() * 12 + 4, // Bán kính
            d: Math.random() * mp,     // Mật độ
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            tilt: Math.floor(Math.random() * 10) - 10,
            tiltAngle: 0,
            tiltAngleIncremental: Math.random() * 0.07 + 0.05
        });
    }

    let angle = 0;
    let animationId;

    function draw() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach((p, i) => {
            angle += 0.01;
            p.tiltAngle += p.tiltAngleIncremental;
            p.y += (Math.cos(angle + p.d) + 3 + p.r / 2) / 2;
            p.x += Math.sin(angle);
            p.tilt = Math.sin(p.tiltAngle) * 15;

            ctx.beginPath();
            ctx.lineWidth = p.r / 2;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
            ctx.stroke();

            // Nếu hạt rơi hết -> reset lại lên trên (tạo hiệu ứng mưa)
            // Hoặc muốn dừng thì check condition
            if (p.y > H) {
                 // Để tạo hiệu ứng "nổ" 1 lần rồi thôi, ta cho nó rơi ra khỏi màn hình rồi ẩn
                 // Nếu muốn lặp lại vô tận thì uncomment dòng dưới:
                 // p.x = Math.random() * W; p.y = -10;
                 particles.splice(i, 1);
            }
        });

        if (particles.length > 0) {
            animationId = requestAnimationFrame(draw);
        } else {
            canvas.style.display = "none";
            cancelAnimationFrame(animationId);
        }
    }
    
    draw();
}

// ==========================================
// IRREGULAR VERBS LOGIC (FROM SHEET)
// ==========================================

let cachedIrregularData = []; // Biến lưu data tải từ Sheet
let isIrregularLoaded = false; // Cờ đánh dấu đã tải chưa

// Hàm hiển thị Toast Loading (Góc trái)
function showLoadingToast(show, text = "Đang xử lý...") {
    const toast = document.getElementById("toast-loading");
    const textEl = document.getElementById("toast-loading-text");
    
    if (!toast) return;

    if (show) {
        if (textEl) textEl.textContent = text;
        toast.style.display = "flex"; // Đảm bảo flex để căn chỉnh
        // Cho một chút delay để transition hoạt động
        setTimeout(() => toast.classList.add("show"), 10);
    } else {
        toast.classList.remove("show");
        // Đợi transition xong mới ẩn hẳn
        setTimeout(() => {
            if (!toast.classList.contains("show")) {
                toast.style.display = "none";
            }
        }, 300);
    }
}
// CẬP NHẬT HÀM FETCH BQT
async function fetchIrregularVerbsFromSheet() {
    if (isIrregularLoaded) return; 

    // HIỆN TOAST LOADING
    showLoadingToast(true, "Đang tải 360 động từ BQT...");

    try {
        const res = await fetch(LOGIN_API_URL, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getIrregularVerbs" })
        });
        
        const data = await res.json();
        
        if (data.status === "success" && Array.isArray(data.data)) {
            cachedIrregularData = data.data;
            isIrregularLoaded = true;
            
            // Tải xong -> Đổi text thành "Hoàn tất" rồi ẩn sau 1.5s
            const textEl = document.getElementById("toast-loading-text");
            const spinner = document.querySelector("#toast-loading .mini-spinner");
            
            if (textEl) textEl.textContent = "Đã tải xong dữ liệu!";
            if (spinner) spinner.style.borderTopColor = "#10b981"; // Đổi màu xanh lá
            
            setTimeout(() => showLoadingToast(false), 1500);
            
        } else {
            console.warn("Không lấy được dữ liệu BQT");
            showLoadingToast(false);
        }
    } catch (err) {
        console.error("Lỗi fetch BQT:", err);
        showLoadingToast(false);
    }
}

// Hàm thực hiện tìm kiếm và Render
function triggerSearchIrregular() {
    const input = document.getElementById("irregular-search-input");
    const container = document.getElementById("irregular-result-container");
    const placeholder = document.getElementById("irregular-placeholder");
    
    const keyword = (input.value || "").trim().toLowerCase();

    // Reset giao diện
    container.innerHTML = "";
    container.style.display = "none";
    placeholder.style.display = "block";

    if (!keyword) return;

    // Lọc dữ liệu
    // Tìm chính xác hoặc gần đúng
    const results = cachedIrregularData.filter(item => {
        return (item.v1 || "").toLowerCase() === keyword ||
               (item.v2 || "").toLowerCase() === keyword ||
               (item.v3 || "").toLowerCase() === keyword ||
               (item.mean || "").toLowerCase().includes(keyword); // Nghĩa thì tìm gần đúng
    });

    if (results.length > 0) {
        placeholder.style.display = "none";
        container.style.display = "block";
        
        // Render từng kết quả tìm được
        results.forEach(item => {
            const card = document.createElement("div");
            card.className = "verb-detail-card";
            
            card.innerHTML = `
                <div class="verb-meaning">${item.mean}</div>
                <div class="verb-forms-row">
                    <div class="verb-col">
                        <span class="verb-label">Nguyên thể (V1)</span>
                        <div class="verb-word v1-style">${item.v1}</div>
                    </div>
                    <div class="verb-col">
                        <span class="verb-label">Quá khứ (V2)</span>
                        <div class="verb-word v2-style">${item.v2}</div>
                    </div>
                    <div class="verb-col">
                        <span class="verb-label">Phân từ II (V3)</span>
                        <div class="verb-word v3-style">${item.v3}</div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } else {
        // Không tìm thấy
        placeholder.style.display = "block";
        placeholder.innerHTML = `<div style="font-size:30px">🤷‍♂️</div><div>Không tìm thấy từ "<b>${input.value}</b>" trong dữ liệu.</div>`;
    }
}

// Lắng nghe sự kiện gõ phím (Realtime search hoặc Enter)
const irrInput = document.getElementById("irregular-search-input");
if (irrInput) {
    irrInput.addEventListener("keyup", (e) => {
        // Tự động tìm sau khi gõ (hoặc check e.key === 'Enter' nếu muốn phải Enter mới tìm)
        triggerSearchIrregular();
    });
}


// Biến lưu trạng thái để tránh báo lặp lại liên tục
let hasNotifiedExpiration = false;

// Hàm chạy ngầm: Tự động kiểm tra hạn mỗi 60 giây
function startExpirationLoop() {
    // Chạy ngay lập tức 1 lần khi gọi
    checkAndNotify();

    // Sau đó lặp lại mỗi 60s
    setInterval(() => {
        checkAndNotify();
    }, 60000); 
}

function checkAndNotify() {
    // Nếu hết hạn VÀ chưa thông báo lần nào trong phiên này
    if (isExpired()) {
        if (!hasNotifiedExpiration) {
            // 1. Hiện thông báo Toast
            showToast("Tài khoản đã hết hạn. Chuyển sang chế độ CHỈ XEM.", "error");
            
            // 2. Cập nhật giao diện (Thêm nhãn "Hết hạn" cạnh tên user hoặc logo)
            updateUserUI_Expired();
            
            // Đánh dấu là đã báo rồi để ko spam toast mỗi phút
            hasNotifiedExpiration = true; 
        }
    }
}

let expirationInterval = null;

// Hàm khởi chạy vòng lặp kiểm tra (Gọi trong init)
function startRealtimeLoop() {
    // Chạy ngay lập tức để render UI
    checkAndRenderStatus();

    // Sau đó lặp lại mỗi 1 giây (1000ms) để đếm ngược mượt mà
    if (expirationInterval) clearInterval(expirationInterval);
    expirationInterval = setInterval(() => {
        checkAndRenderStatus();
    }, 1000); 
}

// Hàm xử lý trung tâm: Kiểm tra quyền + Cập nhật đồng hồ
function checkAndRenderStatus() {
    const timerBadge = document.getElementById("trial-timer-badge");
    const countdownEl = document.getElementById("trial-countdown");

    // 1. Nếu là VIP (Đã trả phí) -> Ẩn huy hiệu
    if (!isPaidExpired()) {
        if (timerBadge) timerBadge.style.display = "none";
        renderUserStatus(); 
        return;
    }

    // 2. Nếu chưa trả phí
    if (isTrialActive()) {
        // --- CÒN DÙNG THỬ ---
        if (timerBadge) {
            timerBadge.style.display = "block";
            timerBadge.classList.remove("expired");
            
            // Tính giờ
            const regDate = new Date(currentUser.regDate);
            const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
            const now = new Date();
            const diffMs = trialEndTime - now;

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

            // Format số đẹp (01:05:09)
            const hStr = hours.toString().padStart(2, '0');
            const mStr = minutes.toString().padStart(2, '0');
            const sStr = seconds.toString().padStart(2, '0');

            if (countdownEl) {
                countdownEl.textContent = `${hStr}:${mStr}:${sStr}`;
            }

            const label = timerBadge.querySelector('.timer-label');
            const sub = timerBadge.querySelector('.timer-sub');
            if (label) label.textContent = "⚡ DÙNG THỬ MIỄN PHÍ";
            if (sub) sub.textContent = "Gia hạn để dùng vĩnh viễn";
        }
    } else {
        // --- HẾT HẠN ---
        if (timerBadge) {
            timerBadge.style.display = "block";
            timerBadge.classList.add("expired"); // Đổi màu đỏ
            
            // Sửa nội dung báo hết hạn
            if (countdownEl) countdownEl.textContent = "00:00:00";
            
            const label = timerBadge.querySelector('.timer-label');
            const sub = timerBadge.querySelector('.timer-sub');
            if (label) label.textContent = "⛔ ĐÃ HẾT HẠN";
            if (sub) sub.textContent = "Vui lòng gia hạn ngay";
        }
        updateUserUI_Expired();
    }

    renderUserStatus();
}

// Hàm cập nhật giao diện khi biết là hết hạn
function updateUserUI_Expired() {
    const userPill = document.getElementById("user-display");
    if (userPill) {
        userPill.style.background = "#fee2e2"; 
        userPill.style.color = "#b91c1c";
        userPill.style.border = "1px solid #ef4444";
        // Chỉ thêm chữ nếu chưa có
        if (!userPill.textContent.includes("Hết hạn")) {
             // Giữ lại tên, chỉ thêm status
             // userPill.textContent += " (Hết hạn)"; <-- Cách này dễ bị spam text
             // Nên render lại sạch sẽ:
             userPill.innerHTML = `👤 ${currentUser.name || currentUser.email} <small>(Hết hạn)</small>`;
        }
    }
}
// ===== INIT =====
function initStatusSelectOptions() {
    if (!statusSelect) return;
    statusSelect.innerHTML = "";

    STATUS_CONFIG.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.value;
        opt.textContent = st.label;
        statusSelect.appendChild(opt);
    });
}


(async function init() {
    requireLoginOrRedirect();
    
    await syncAccountStatus(); 
    startRealtimeLoop();
    startExpirationLoop();

    // Gọi hàm cập nhật UI mới
    updateUI_InitState();

    initStatusSelectOptions();
    await fetchWordsFromSheet();
    renderWords();
    updateCount();
    updateStreak();
    updateFolderSuggestions();
})();