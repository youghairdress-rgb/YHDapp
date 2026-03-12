import { db, initializeLiffAndAuth } from './admin/firebase-init.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";


// --- DOM Helper Functions ---
const showLoading = (text) => {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('content-container').style.display = 'none';
    // 笘・・笘・霑ｽ蜉: 閭梧勹繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繧堤┌蜉ｹ蛹・笘・・笘・    document.body.classList.add('user-modal-open');
};
const showContent = () => {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('content-container').style.display = 'block';
    // 笘・・笘・霑ｽ蜉: 閭梧勹繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繧呈怏蜉ｹ蛹・笘・・笘・    document.body.classList.remove('user-modal-open');
};
const showError = (text) => {
    document.getElementById('error-message').textContent = text;
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('error-container').style.display = 'block';
    // 笘・・笘・霑ｽ蜉: 閭梧勹繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繧呈怏蜉ｹ蛹・笘・・笘・    document.body.classList.remove('user-modal-open');
};

// --- Main Application Logic ---
const main = async () => {
    try {
        showLoading("LIFF繧貞・譛溷喧荳ｭ...");
        const { user, profile } = await initializeLiffAndAuth("2008029428-bjdA0Ddp");

        showLoading("鬘ｧ螳｢諠・ｱ繧堤｢ｺ隱堺ｸｭ...");
        const userDocRef = doc(db, "users", profile.userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            // 逋ｻ骭ｲ貂医∩縺ｮ蝣ｴ蜷医・繝槭う繝壹・繧ｸ縺ｸ繝ｪ繝繧､繝ｬ繧ｯ繝・            window.location.href = './mypage.html';
        } else {
            // 譛ｪ逋ｻ骭ｲ縺ｮ蝣ｴ蜷医・逋ｻ骭ｲ繝輔か繝ｼ繝繧定｡ｨ遉ｺ
            setupRegistrationForm(profile);
            showContent();
        }

    } catch (error) {
        console.error("繝｡繧､繝ｳ蜃ｦ逅・〒繧ｨ繝ｩ繝ｼ:", error);
        showError(error.message);
    }
};

const setupRegistrationForm = (profile) => {
    const form = document.getElementById('registration-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        showLoading("鬘ｧ螳｢諠・ｱ繧堤匳骭ｲ荳ｭ...");
        
        const formData = new FormData(form);
        const name = formData.get('name').trim();
        const kana = formData.get('kana').trim();
        const phone = formData.get('phone').trim();

        if (!name || !kana) {
            alert('縺雁錐蜑阪→縺ｵ繧翫′縺ｪ縺ｯ蠢・医〒縺吶・);
            showContent();
            return;
        }

        try {
            const existingUserQuery = query(
                collection(db, "users"),
                where("kana", "==", kana),
                where("phone", "==", phone),
                where("isLineUser", "==", false)
            );

            const querySnapshot = await getDocs(existingUserQuery);
            
            if (!querySnapshot.empty) {
                const existingUserDoc = querySnapshot.docs[0];
                const oldUserId = existingUserDoc.id;

                const mergeUserData = httpsCallable(functions, 'mergeUserData');
                await mergeUserData({ oldUserId: oldUserId, newUserId: profile.userId, profile: profile });
                
                alert("譌｢蟄倥・鬘ｧ螳｢諠・ｱ縺ｨLINE繧｢繧ｫ繧ｦ繝ｳ繝医ｒ邨ｱ蜷医＠縺ｾ縺励◆縲・);

            } else {
                const newUserDocRef = doc(db, "users", profile.userId);
                await setDoc(newUserDocRef, {
                    name: name,
                    kana: kana,
                    phone: phone,
                    lineUserId: profile.userId,
                    lineDisplayName: profile.displayName,
                    isLineUser: true,
                    createdAt: serverTimestamp(),
                });
            }

            window.location.href = './mypage.html';

        } catch (error) {
            console.error("逋ｻ骭ｲ縺ｾ縺溘・邨ｱ蜷亥・逅・↓螟ｱ謨励＠縺ｾ縺励◆:", error);
            showError(`逋ｻ骭ｲ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
        }
    };
};

document.addEventListener('DOMContentLoaded', main);
