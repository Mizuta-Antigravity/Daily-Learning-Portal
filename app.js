const App = {
    currentUser: null,
    currentView: 'auth', // 'auth', 'student', 'admin'
    authTab: 'student', // 'student', 'admin'
    isAdmin: false,

    init: async () => {
        // DB init natively handled by Firebase Global
        App.setupEventListeners();
        App.checkRememberMe();
        App.render();
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

        if (App.authTab === 'admin') {
            // Admin login logic
            if (prefix === 'admin' && password === 'admin123') {
                const user = { name: '管理者', is_admin: true, email: 'admin' };
                App.loginSuccess(user, remember, password, 'admin');
                return;
            } else {
                return alert('管理者IDまたはパスワードが正しくありません');
            }
        }

        // Student check
        const email = `${prefix}@hokuyo2.kansai-u.ac.jp`;
        
        // Find user in DB or allow if prefix exists (Mock lookup)
        try {
            const doc = await db.collection('users').doc(email).get();
            const user = doc.exists ? doc.data() : null;
            
            // If user not found, we'll check if they are in the CSV uploaded list or just mock it
            if (user) {
                if (user.password === password) {
                    if (password === 'GE12345' && !user.pw_changed) {
                        // Force password change
                        document.getElementById('login-form').style.display = 'none';
                        document.getElementById('pw-change-form').style.display = 'block';
                        App.currentUser = user;
                        return;
                    }
                    App.loginSuccess(user, remember, password);
                } else {
                    alert('パスワードが違います');
                }
            } else {
                // If user not in DB, but it's the initial password, let them in (Mock registration)
                if (password === 'GE12345') {
                    const newUser = { id: email, email, name: '生徒', password: 'GE12345', pw_changed: false };
                    document.getElementById('login-form').style.display = 'none';
                    document.getElementById('pw-change-form').style.display = 'block';
                    App.currentUser = newUser;
                    alert('初回ログインです。パスワードを変更してください。');
                } else {
                    alert('ユーザーが見つかりません');
                }
            }
        } catch (e) {
            console.error('Error fetching user', e);
            alert('ログインサーバーとの通信に失敗しました');
        }
    },

    loginSuccess: (user, remember, password, view = 'student') => {
        App.currentUser = user;
        App.currentView = view;
        App.isAdmin = user.is_admin || false;
        
        if (remember) {
            const prefix = user.email.includes('@') ? user.email.split('@')[0] : user.email;
            localStorage.setItem('rememberUser', JSON.stringify({ prefix, password }));
        } else {
            localStorage.removeItem('rememberUser');
        }

        App.render();
    },

    handlePasswordChange: async () => {
        const newPw = document.getElementById('new-password').value;
        const confirmPw = document.getElementById('confirm-password').value;

        if (newPw.length < 6) return alert('パスワードは6文字以上で入力してください');
        if (newPw !== confirmPw) return alert('パスワードが一致しません');

        try {
            App.currentUser.password = newPw;
            App.currentUser.pw_changed = true;
            await db.collection('users').doc(App.currentUser.email).set(App.currentUser);
            
            alert('パスワードを変更しました');
            App.loginSuccess(App.currentUser, false, '');
        } catch (e) {
            console.error('Error updating password', e);
            alert('パスワードの更新に失敗しました');
        }
    },

    handleForgotPassword: () => {
        const prefix = document.getElementById('email-prefix').value;
        if (!prefix) return alert('メールアドレスの接頭辞を入力してください');
        alert(`${prefix}@hokuyo2.kansai-u.ac.jp 宛に再設定メールを送信しました（シミュレーション）`);
    },

    handleLogout: () => {
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
