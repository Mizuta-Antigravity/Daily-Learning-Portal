const App = {
    currentUser: null,
    currentView: 'auth', // 'auth', 'student', 'admin'
    authTab: 'student', // 'student', 'admin'
    isAdmin: false,

    init: async () => {
        App.setupEventListeners();
        App.checkRememberMe();
        
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                if (user.email === 'admin@hokuyo2.kansai-u.ac.jp' || user.email === 'admin') {
                    const adminUser = { name: '管理者', is_admin: true, email: user.email };
                    App.loginSuccess(adminUser, false, null, 'admin');
                } else {
                    try {
                        const doc = await db.collection('users').doc(user.email).get();
                        if (doc.exists) {
                            const dbUser = doc.data();
                            if (!dbUser.pw_changed) {
                                document.getElementById('login-form').style.display = 'none';
                                document.getElementById('pw-change-form').style.display = 'block';
                                App.currentUser = dbUser;
                                return;
                            }
                            App.loginSuccess(dbUser, false, null, 'student');
                        } else {
                            auth.signOut();
                        }
                    } catch (e) {
                        console.error('Error fetching user data', e);
                    }
                }
            } else {
                if (!App.currentUser && App.currentView !== 'auth') {
                    App.currentView = 'auth';
                }
                App.render();
            }
        });
    },

    setupEventListeners: () => {
        document.getElementById('login-btn').onclick = App.handleLogin;
        document.getElementById('show-password').onchange = (e) => {
            document.getElementById('password').type = e.target.checked ? 'text' : 'password';
        };
        document.getElementById('logout-btn').onclick = App.handleLogout;
        document.getElementById('nav-student').onclick = () => App.switchPortal('student');
        document.getElementById('nav-admin').onclick = () => App.switchPortal('admin');
        document.getElementById('change-pw-btn').onclick = App.handlePasswordChange;
        document.getElementById('forgot-password-link').onclick = App.handleForgotPassword;

        // Auth Tabs
        document.getElementById('tab-student').onclick = () => App.switchAuthTab('student');
        document.getElementById('tab-admin').onclick = () => App.switchAuthTab('admin');
    },

    switchAuthTab: (tab) => {
        App.authTab = tab;
        App.render();
    },

    checkRememberMe: () => {
        const saved = localStorage.getItem('rememberUser');
        if (saved) {
            const data = JSON.parse(saved);
            document.getElementById('email-prefix').value = data.prefix;
            document.getElementById('password').value = data.password;
            document.getElementById('remember-me').checked = true;
            if (data.prefix === 'admin') {
                App.authTab = 'admin';
            }
        }
    },

    handleLogin: async () => {
        const prefix = document.getElementById('email-prefix').value;
        const password = document.getElementById('password').value;
        const remember = document.getElementById('remember-me').checked;

        if (!prefix || !password) return alert('IDとパスワードを入力してください');

        const email = App.authTab === 'admin' ? 
            (prefix === 'admin' ? 'admin@hokuyo2.kansai-u.ac.jp' : prefix) : 
            `${prefix}@hokuyo2.kansai-u.ac.jp`;

        try {
            await firebase.auth().setPersistence(
                remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION
            );
            
            if (remember) {
                localStorage.setItem('rememberUser', JSON.stringify({ prefix, password }));
            } else {
                localStorage.removeItem('rememberUser');
            }

            await auth.signInWithEmailAndPassword(email, password);
            // onAuthStateChanged will handle the rest
        } catch (e) {
            console.error('Error logging in', e);
            alert('ログインに失敗しました。IDまたはパスワードが間違っています。');
        }
    },

    loginSuccess: (user, remember, password, view = 'student') => {
        App.currentUser = user;
        App.currentView = view;
        App.isAdmin = user.is_admin || false;
        
        App.render();
    },

    handlePasswordChange: async () => {
        const newPw = document.getElementById('new-password').value;
        const confirmPw = document.getElementById('confirm-password').value;

        if (newPw.length < 6) return alert('パスワードは6文字以上で入力してください');
        if (newPw !== confirmPw) return alert('パスワードが一致しません');

        try {
            await auth.currentUser.updatePassword(newPw);
            
            App.currentUser.pw_changed = true;
            await db.collection('users').doc(App.currentUser.email).set({
                ...App.currentUser,
                password: firebase.firestore.FieldValue.delete()
            }, { merge: true });
            
            alert('パスワードを変更しました');
            App.loginSuccess(App.currentUser, false, '', 'student');
        } catch (e) {
            console.error('Error updating password', e);
            if (e.code === 'auth/requires-recent-login') {
                alert('セキュリティのため、一度ログアウトして再ログインしてからパスワードを変更してください');
            } else {
                alert('パスワードの更新に失敗しました: ' + e.message);
            }
        }
    },

    handleForgotPassword: async () => {
        const prefix = document.getElementById('email-prefix').value;
        if (!prefix) return alert('メールアドレスの接頭辞を入力してください');
        const email = App.authTab === 'admin' ? 
            (prefix === 'admin' ? 'admin@hokuyo2.kansai-u.ac.jp' : prefix) : 
            `${prefix}@hokuyo2.kansai-u.ac.jp`;
            
        try {
            await auth.sendPasswordResetEmail(email);
            alert(`${email} 宛にパスワード再設定メールを送信しました`);
        } catch(e) {
            alert('再設定メールの送信に失敗しました');
        }
    },

    handleLogout: async () => {
        try {
            await auth.signOut();
        } catch (e) {
            console.error(e);
        }
        App.currentUser = null;
        App.currentView = 'auth';
        App.render();
    },

    switchPortal: (view) => {
        App.currentView = view;
        App.render();
    },

    render: () => {
        // Hide all major views
        document.getElementById('auth-view').style.display = 'none';
        document.getElementById('portal-view').style.display = 'none';
        
        if (App.currentView === 'auth') {
            document.getElementById('auth-view').style.display = 'block';
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('pw-change-form').style.display = 'none';

            // Auth Tab state
            const isStudent = App.authTab === 'student';
            document.getElementById('tab-student').classList.toggle('active', isStudent);
            document.getElementById('tab-admin').classList.toggle('active', !isStudent);
            
            document.getElementById('auth-title').innerText = isStudent ? '生徒ログイン' : '管理者ログイン';
            document.getElementById('id-label').innerText = isStudent ? 'メールアドレス (ID)' : '管理者ID';
            document.getElementById('email-domain').classList.toggle('hidden', !isStudent);
            document.getElementById('email-prefix').placeholder = isStudent ? 'xxxxxxxx' : 'admin';
            
            // Adjust input width if domain is hidden
            document.getElementById('email-prefix').style.paddingRight = isStudent ? '1rem' : '1rem';
        } else {
            document.getElementById('portal-view').style.display = 'block';
            
            // Header Top Bar configurations
            document.getElementById('admin-nav').style.display = App.isAdmin ? 'flex' : 'none';
            document.getElementById('user-display-name').innerText = App.currentUser.name;

            if (App.currentView === 'student') {
                document.getElementById('student-container').style.display = 'block';
                document.getElementById('admin-container').style.display = 'none';
                document.getElementById('nav-student').classList.add('active');
                document.getElementById('nav-admin').classList.remove('active');
                document.getElementById('student-header-controls').style.display = 'flex';
                const manualBtn = document.getElementById('admin-manual-btn');
                if (manualBtn) manualBtn.style.display = 'none';
                Student.init();
            } else {
                document.getElementById('student-container').style.display = 'none';
                document.getElementById('admin-container').style.display = 'block';
                document.getElementById('nav-admin').classList.add('active');
                document.getElementById('nav-student').classList.remove('active');
                document.getElementById('student-header-controls').style.display = 'none';
                const manualBtn = document.getElementById('admin-manual-btn');
                if (manualBtn) manualBtn.style.display = 'inline-block';
                Admin.init();
            }
        }    
    }
};

window.onload = App.init;
