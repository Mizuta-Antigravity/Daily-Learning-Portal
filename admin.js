const Admin = {
    currentPeriod: null,

    init: async () => {
        Admin.setupEventListeners();
        await Admin.setupPeriodSelector();
        Admin.renderSchedulePreview();
        Admin.renderStudentList();
        Admin.renderStorageMeter();
        Admin.checkAprilAlert();
    },

    checkAprilAlert: () => {
        const now = new Date();
        const alertEl = document.getElementById('april-alert');
        // April is month index 3
        if (alertEl && now.getMonth() === 3) {
            alertEl.style.display = 'block';
        } else if (alertEl) {
            alertEl.style.display = 'none';
        }
    },

    renderStorageMeter: async () => {
        const textEl = document.getElementById('storage-used-text');
        const barEl = document.getElementById('storage-progress-bar');
        if (!textEl || !barEl) return;

        textEl.innerText = '計算中...';
        
        try {
            const totalBytes = await Utils.getTotalStorageSize();
            const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
            
            const mb = (totalBytes / (1024 * 1024)).toFixed(1);
            const percent = ((totalBytes / MAX_BYTES) * 100).toFixed(2);
            
            textEl.innerText = `${mb} MB / 5.0 GB (${percent}%)`;
            barEl.style.width = `${Math.min(percent, 100)}%`;
            
            // Warning colors
            if (percent > 90) {
                barEl.style.background = 'var(--error)';
                textEl.style.color = 'var(--error)';
            } else if (percent > 70) {
                barEl.style.background = '#f59e0b';
                textEl.style.color = '#f59e0b';
            } else {
                barEl.style.background = 'linear-gradient(90deg, #10b981, #3b82f6)';
                textEl.style.color = 'var(--primary)';
            }

        } catch (e) {
            textEl.innerText = '計算エラー';
        }
    },

    setupEventListeners: () => {
        document.getElementById('csv-students').onchange = Admin.handleStudentCSV;
        document.getElementById('csv-events').onchange = Admin.handleEventCSV;
        document.getElementById('process-bulk-upload').onclick = Admin.handleBulkUpload;
        document.getElementById('excel-to-csv-input').onchange = Admin.handleExcelToCSV;
        document.getElementById('admin-period-select').onchange = (e) => {
            Admin.currentPeriod = e.target.value;
            Admin.renderSchedulePreview();
        };
    },

    setupPeriodSelector: async () => {
        const schedule = await Utils.getAllSchedule();
        const periods = Utils.identifyPeriods(schedule);
        const selector = document.getElementById('admin-period-select');
        
        selector.innerHTML = periods.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        selector.innerHTML += '<option value="all">全て表示</option>';

        if (Admin.currentPeriod === null) {
            Admin.currentPeriod = 'all'; // Default to "すべて表示"
        }
        selector.value = Admin.currentPeriod || 'all';
    },

    handleExcelToCSV: async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let lastMonth = null;
        let lastDay = null;
        let lastWeekday = null;
        const grouped = new Map();
        
        rows.forEach((row) => {
            if (!row || row.length < 1) return;
            if (row[0] !== undefined && row[0] !== null && row[0] !== '') {
                lastMonth = parseInt(String(row[0]).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)));
            }
            if (row[3] !== undefined && row[3] !== null && row[3] !== '') {
                lastDay = parseInt(row[3]);
            }
            if (row[4] !== undefined && row[4] !== null && row[4] !== '') {
                lastWeekday = row[4];
            }
            const event = row[5];
            if (isNaN(lastMonth) || isNaN(lastDay) || !event) return;
            
            const key = `${lastMonth}-${lastDay}`;
            const eventStr = String(event).trim();
            if (grouped.has(key)) {
                const existing = grouped.get(key);
                existing.event = `${existing.event} , ${eventStr}`;
            } else {
                grouped.set(key, { month: lastMonth, day: lastDay, weekday: lastWeekday, event: eventStr });
            }
        });

        // --- NEW LOGIC START ---
        // 1. Find all exam start dates
        const examStartDates = [];
        grouped.forEach(item => {
            if (item.event.includes('中間試験') || item.event.includes('期末試験')) {
                // Approximate year (doesn't matter for relative math)
                const year = item.month <= 3 ? 2027 : 2026;
                examStartDates.push(new Date(year, item.month - 1, item.day));
            }
        });

        // 2. Identify prep weeks (7 days before each exam date)
        const prepDates = new Set();
        examStartDates.forEach(examDate => {
            for (let i = 1; i <= 7; i++) {
                const prepDate = new Date(examDate);
                prepDate.setDate(examDate.getDate() - i);
                const m = prepDate.getMonth() + 1;
                const d = prepDate.getDate();
                prepDates.add(`${m}-${d}`);
            }
        });

        const keywords0 = ['終業式', '国民の祝日', '振替休日', '中間試験', '期末試験', '実力テスト', '校外学習', '体育祭', '体育祭予行', '卒業式', '始業式'];
        const isBetween = (m, d, sm, sd, em, ed) => {
            const v = m * 100 + d;
            const sv = sm * 100 + sd;
            const ev = em * 100 + ed;
            if (sv <= ev) return v >= sv && v <= ev;
            // Over year boundary (Dec-Jan or Mar-Apr cases)
            return v >= sv || v <= ev;
        };

        // --- NEW FULL CALENDAR LOGIC START ---
        const resultRows = [];
        const startDate = new Date(2026, 3, 1); // April 1, 2026
        const endDate = new Date(2027, 2, 31); // March 31, 2027
        
        // Helper: get jp weekday
        const getWd = (d) => ['日','月','火','水','木','金','土'][d.getDay()];

        let current = new Date(startDate);
        while (current <= endDate) {
            const m = current.getMonth() + 1;
            const d = current.getDate();
            const wd = getWd(current);
            const key = `${m}-${d}`;
            
            const excelData = grouped.get(key);
            const event = excelData ? excelData.event : '';
            
            let status = '1';
            // Rule 1: Fixed Ranges
            if (isBetween(m, d, 7, 20, 8, 24) || isBetween(m, d, 12, 25, 1, 7) || isBetween(m, d, 3, 20, 4, 1)) {
                status = '0';
            }
            // Rule 2: Keywords
            if (event && keywords0.some(kw => event.includes(kw))) {
                status = '0';
            }
            // Rule 3: Exam Prep (1 week before)
            if (prepDates.has(`${m}-${d}`)) {
                status = '0';
            }
            // Rule 4: Special old rule (4/1-4/7)
            if (m === 4 && d >= 1 && d <= 7) {
                status = '0';
            }

            const safeEvent = event.includes(',') ? `"${event}"` : event;
            resultRows.push(`${m},${d},${wd},${safeEvent},${status}`);
            
            current.setDate(current.getDate() + 1);
        }

        let csvContent = '月,日,曜日,行事名,実施有無\n' + resultRows.join('\n') + '\n';
        // --- NEW FULL CALENDAR LOGIC END ---
        
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.body.appendChild(document.createElement('a'));
        a.download = `${file.name.replace(/\.[^/.]+$/, "")}-変換済み.csv`;
        a.href = url;
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        
        alert('変換が完了しました。');
        e.target.value = '';
    },

    downloadTemplate: (type) => {
        const templates = {
            student: 'メールアドレス,生徒の名前,クラス,出席番',
            schedule: '月,日,曜日,行事名,実施有無\n4,1,月,始業式,0\n4,2,火,新入生歓迎会,1'
        };
        const content = templates[type];
        const fileName = `${type}_template.csv`;
        
        // Add BOM for Excel UTF-8
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    handleStudentCSV: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const data = Utils.parseCSV(text);
        
        const batch = db.batch();
        data.forEach(item => {
            const email = item['メールアドレス'];
            const docRef = db.collection('users').doc(email);
            batch.set(docRef, {
                id: email,
                email,
                name: item['生徒の名前'],
                class: item['クラス'],
                attendance: item['出席番'],
                password: 'DLP2026',
                pw_changed: false
            }, { merge: true });
        });
        
        try {
            await batch.commit();
            alert(`${data.length}名の生徒情報をインポートしました`);
            Admin.renderStudentList();
        } catch (e) {
            console.error('Error importing students:', e);
            alert('生徒情報のインポートに失敗しました。');
        }
    },

    renderStudentList: async () => {
        try {
            const snapshot = await db.collection('users').get();
            const users = [];
            snapshot.forEach(doc => {
                if (doc.data().email !== 'admin') users.push(doc.data());
            });

            // Sort by name ascending
            users.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

            const container = document.getElementById('student-table-container');
            
            if (users.length === 0) {
                container.innerHTML = '<p class="subtitle">生徒情報が未登録です</p>';
                document.getElementById('student-batch-actions').style.display = 'none';
                return;
            }

            let html = `
                <table class="glass">
                    <thead>
                        <tr>
                            <th style="width: 40px; text-align: center;"><input type="checkbox" id="select-all-students" onchange="Admin.toggleAllStudents(this.checked)"></th>
                            <th>名前</th>
                            <th>メールアドレス</th>
                            <th>クラス</th>
                            <th>出席番</th>
                            <th>PW変更済</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            users.forEach(user => {
                html += `
                    <tr>
                        <td style="text-align: center;"><input type="checkbox" class="student-cb" data-email="${user.email}" onchange="Admin.updateStudentBatchUI()"></td>
                        <td>${user.name}</td>
                        <td>${user.email}</td>
                        <td>${user.class || 'ー'}</td>
                        <td>${user.attendance || 'ー'}</td>
                        <td>${user.pw_changed ? '✅' : '❌'}</td>
                    </tr>
                `;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
            Admin.updateStudentBatchUI();
        } catch (e) {
            console.error('Error fetching students:', e);
            document.getElementById('student-table-container').innerHTML = '<p class="error">生徒情報の読み込みに失敗しました。</p>';
        }
    },

    toggleAllStudents: (checked) => {
        const checkboxes = document.querySelectorAll('.student-cb');
        checkboxes.forEach(cb => cb.checked = checked);
        Admin.updateStudentBatchUI();
    },

    updateStudentBatchUI: () => {
        const checkboxes = document.querySelectorAll('.student-cb:checked');
        const container = document.getElementById('student-batch-actions');
        const countText = document.getElementById('selected-student-count');
        const masterCb = document.getElementById('select-all-students');
        const allCheckboxes = document.querySelectorAll('.student-cb');
        
        if (container) {
            container.style.display = checkboxes.length > 0 ? 'flex' : 'none';
            countText.innerText = `${checkboxes.length}名選択中`;
        }
        if (masterCb && allCheckboxes.length > 0) {
            masterCb.checked = checkboxes.length === allCheckboxes.length;
        }
    },

    deleteSelectedStudents: async () => {
        const checkboxes = document.querySelectorAll('.student-cb:checked');
        if (checkboxes.length === 0) return;
        
        if (!confirm(`選択した ${checkboxes.length} 名の生徒を削除してもよろしいですか？`)) return;
        
        const batch = db.batch();
        checkboxes.forEach(cb => {
            const email = cb.getAttribute('data-email');
            batch.delete(db.collection('users').doc(email));
        });
        
        await batch.commit();
        alert('削除しました');
        Admin.renderStudentList();
    },

    resetSelectedPasswords: async () => {
        const checkboxes = document.querySelectorAll('.student-cb:checked');
        if (checkboxes.length === 0) return;
        
        const newPassword = prompt(`選択した ${checkboxes.length} 名のパスワードをリセットします。新しい共通パスワードを入力してください (例: DLP2026):`, "DLP2026");
        
        if (!newPassword || newPassword.trim() === "") return;
        if (newPassword.length < 6) return alert('パスワードは6文字以上で入力してください。');

        const batch = db.batch();
        checkboxes.forEach(cb => {
            const email = cb.getAttribute('data-email');
            batch.update(db.collection('users').doc(email), {
                password: newPassword,
                pw_changed: false
            });
        });
        
        await batch.commit();
        alert(`パスワードを「${newPassword}」に変更しました。`);
        Admin.renderStudentList();
    },

    handleEventCSV: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const data = Utils.parseCSV(text);
        
        await Utils.saveSchedule(data);
        alert(`${data.length}件の行事予定をインポートしました`);
        Admin.renderSchedulePreview();
        Admin.renderStorageMeter();
    },

    handleBulkUpload: async () => {
        const qFiles = document.getElementById('bulk-questions').files;
        const aFiles = document.getElementById('bulk-answers').files;
        const monthInput = document.getElementById('upload-month').value;

        if (!monthInput || monthInput === "") return alert('対象月を選択してください');
        const [year, month] = monthInput.split('-').map(Number);
        
        const schedule = await Utils.getAllSchedule();
        
        // Helper: same logic as academicSort but encapsulated
        const getRank = (m, d) => {
            const mm = parseInt(m);
            const dd = parseInt(d);
            return (mm >= 4 ? mm - 4 : mm + 8) * 100 + dd;
        };
        const selectedMonthRank = getRank(month, 0);

        // Filter schedule for this month and onwards in the academic year where implementation = 1
        const targetDates = schedule.filter(item => {
            if (item.実施有無 != 1) return false;
            const itemRank = getRank(item.月, item.日);
            return itemRank >= selectedMonthRank;
        }).sort((a, b) => getRank(a.月, a.日) - getRank(b.月, b.日));

        if (targetDates.length === 0) return alert('指定された月以降に実施日は設定されていません');

        // Sort files by numerical name
        const sortFiles = (fileList) => {
            return Array.from(fileList).sort((a, b) => {
                const numA = parseInt(a.name.match(/\d+/) || 0);
                const numB = parseInt(b.name.match(/\d+/) || 0);
                return numA - numB;
            });
        };

        const sortedQ = sortFiles(qFiles);
        const sortedA = sortFiles(aFiles);
        const maxFiles = Math.max(sortedQ.length, sortedA.length);

        if (maxFiles === 0) return alert('アップロードするファイルを選択してください');

        Admin.showLoading('一括アップロード中...', `準備しています... (0/${maxFiles}件)`);

        let completed = 0;
        const CONCURRENCY = 3; // Process 3 dates at a time
        const totalToProcess = Math.min(maxFiles, targetDates.length);
        
        for (let i = 0; i < maxFiles; i += CONCURRENCY) {
            const batch = [];
            for (let j = 0; j < CONCURRENCY && (i + j) < maxFiles; j++) {
                const index = i + j;
                if (index >= targetDates.length) break; // Out of implementation days

                const dateStr = targetDates[index].id;
                
                const uploadDatePromises = [];
                if (sortedQ[index]) {
                    uploadDatePromises.push(Utils.saveFile(`${dateStr}-Q`, sortedQ[index], 'question', dateStr));
                }
                if (sortedA[index]) {
                    uploadDatePromises.push(Utils.saveFile(`${dateStr}-A`, sortedA[index], 'answer', dateStr));
                }
                
                batch.push(Promise.all(uploadDatePromises).then(() => {
                    completed++;
                    const percent = Math.round((completed / totalToProcess) * 100);
                    Admin.updateLoading(`アップロード中... (${completed}/${totalToProcess}件)`, percent);
                }));
            }
            
            if (batch.length > 0) {
                await Promise.all(batch);
            } else {
                break; // No more target dates but still have files
            }
        }

        Admin.hideLoading();
        
        if (maxFiles > targetDates.length) {
            alert(`一部のファイルがアップロードされませんでした。\n実施日が足りません (実施日: ${targetDates.length}件、ファイル: ${maxFiles}件)`);
        } else {
            alert(`処理完了:\n合計 ${totalToProcess}件の実施日にファイルを割り当てました。`);
        }
        
        Admin.renderSchedulePreview();
        Admin.renderStorageMeter();
    },

    renderSchedulePreview: async () => {
        const schedule = await Utils.getAllSchedule();
        const container = document.getElementById('admin-schedule-preview');
        
        if (schedule.length === 0) {
            container.innerHTML = '<p class="subtitle">行事予定が未登録です</p>';
            return;
        }

        // Only show next 30 days or filtered by month
        let html = `
            <table class="glass">
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;"><input type="checkbox" id="select-all-files" onchange="Admin.toggleAllFiles(this.checked)"></th>
                        <th>日付</th>
                        <th>曜日</th>
                        <th>行事名</th>
                        <th>実施</th>
                        <th>問題</th>
                        <th>解答</th>
                        <th>追加</th>
                    </tr>
                </thead>
                <tbody>
        `;


        const academicSort = (a, b) => {
            const ma = parseInt(a.月), da = parseInt(a.日);
            const mb = parseInt(b.月), db = parseInt(b.日);
            const rankA = (ma >= 4 ? ma - 4 : ma + 8) * 100 + da;
            const rankB = (mb >= 4 ? mb - 4 : mb + 8) * 100 + db;
            return rankA - rankB;
        };

        for (let item of schedule.sort(academicSort)) {
            const dateStr = item.id;
            const date = new Date(dateStr);
            const m = date.getMonth() + 1;
            const d = date.getDate();

            // Range filter: 4/1-12/1 and 1/1-3/31
            const inRange = (m === 12 && d === 1) || (m >= 4 && m < 12) || (m >= 1 && m <= 3);
            if (!inRange) continue;

            // Period filter
            if (Admin.currentPeriod && Admin.currentPeriod !== 'all') {
                const periods = Utils.identifyPeriods(schedule);
                const period = periods.find(p => p.name === Admin.currentPeriod);
                if (period && (dateStr < period.start || dateStr > period.end)) continue;
            }

            const qFile = await Admin.checkFileExists(dateStr + '-Q');
            const aFile = await Admin.checkFileExists(dateStr + '-A');

            html += `
                <tr>
                    <td style="text-align: center;">
                        ${qFile || aFile ? `<input type="checkbox" class="file-delete-cb" data-date="${dateStr}" onchange="Admin.updateDeleteBtnState()">` : ''}
                    </td>
                    <td>${item.月}/${item.日}</td>
                    <td>${item.曜日}</td>
                    <td>${item.行事名}</td>
                    <td>
                        <select onchange="Admin.updateImplementationStatus('${dateStr}', this.value)" style="width: auto; padding: 0.2rem; font-size: 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 4px; color: var(--text-main);">
                            <option value="1" ${item.実施有無 == 1 ? 'selected' : ''}>実施</option>
                            <option value="0" ${item.実施有無 == 0 ? 'selected' : ''}>なし</option>
                        </select>
                    </td>
                    <td>${qFile ? '✅' : 'ー'}</td>
                    <td>${aFile ? '✅' : 'ー'}</td>
                    <td>
                        <button onclick="Admin.manualUpload('${dateStr}')" style="width: auto; padding: 0.2rem 0.5rem; font-size: 0.75rem;">+</button>
                    </td>
                </tr>
            `;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    updateImplementationStatus: async (dateId, status) => {
        try {
            await db.collection('schedule').doc(dateId).update({
                実施有無: parseInt(status)
            });
            // Optional: refresh student view if needed, but here simple confirm is enough
            console.log(`Updated status for ${dateId} to ${status}`);
        } catch (e) {
            console.error('Error updating status:', e);
            alert('状態の更新に失敗しました。');
        }
    },

    checkFileExists: async (id) => {
        const file = await Utils.getFile(id);
        return file ? true : false;
    },

    manualUpload: (dateStr) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            const type = prompt('ファイルの種類を入力してください (Q or A)');
            if (type !== 'Q' && type !== 'A') return alert('Q または A を入力してください');
            await Utils.saveFile(`${dateStr}-${type}`, file, type === 'Q' ? 'question' : 'answer', dateStr);
            alert('アップロード完了');
            Admin.renderSchedulePreview();
        };
        input.click();
    },

    toggleAllFiles: (checked) => {
        const checkboxes = document.querySelectorAll('.file-delete-cb');
        checkboxes.forEach(cb => cb.checked = checked);
        Admin.updateDeleteBtnState();
    },

    updateDeleteBtnState: () => {
        const checkboxes = document.querySelectorAll('.file-delete-cb:checked');
        const btn = document.getElementById('delete-selected-files-btn');
        if (btn) {
            btn.style.display = checkboxes.length > 0 ? 'inline-block' : 'none';
        }
        
        // Update master checkbox state appropriately
        const allCheckboxes = document.querySelectorAll('.file-delete-cb');
        const masterCb = document.getElementById('select-all-files');
        if (masterCb && allCheckboxes.length > 0) {
            masterCb.checked = checkboxes.length === allCheckboxes.length;
        }
    },

    deleteSelectedFiles: async () => {
        const checkboxes = document.querySelectorAll('.file-delete-cb:checked');
        if (checkboxes.length === 0) return;
        
        if (!confirm(`選択した ${checkboxes.length} 件の日付に登録されている問題・解答ファイルをすべて削除してもよろしいですか？`)) {
            return;
        }

        const total = checkboxes.length;
        Admin.showLoading('ファイルを削除中...', `準備しています... (0/${total}件)`);
        
        let completed = 0;
        // Processing deletion
        for (const cb of checkboxes) {
            const dateStr = cb.getAttribute('data-date');
            await Utils.deleteFile(`${dateStr}-Q`);
            await Utils.deleteFile(`${dateStr}-A`);
            
            // Revert the downloaded (completed) status
            try {
                let downloaded = JSON.parse(localStorage.getItem('downloaded_days') || '[]');
                if (downloaded.includes(dateStr)) {
                    downloaded = downloaded.filter(d => d !== dateStr);
                    localStorage.setItem('downloaded_days', JSON.stringify(downloaded));
                }
            } catch (e) {
                console.error('Failed to parse downloaded_days from localStorage:', e);
            }
            
            completed++;
            const percent = Math.round((completed / total) * 100);
            Admin.updateLoading(`削除中... (${completed}/${total}件)`, percent);
        }

        Admin.hideLoading();
        alert('ファイルの削除が完了しました');
        
        // Retain the table UI by re-rendering
        const btn = document.getElementById('delete-selected-files-btn');
        if (btn) btn.style.display = 'none';
        Admin.renderSchedulePreview();
        Admin.renderStorageMeter();
    },

    // Loading Overlay Helpers
    showLoading: (title, status) => {
        const overlay = document.getElementById('loading-overlay');
        const titleEl = document.getElementById('loading-title');
        const statusEl = document.getElementById('loading-status');
        const barEl = document.getElementById('loading-bar');
        
        if (overlay) overlay.style.display = 'flex';
        if (titleEl) titleEl.innerText = title || '処理中...';
        if (statusEl) statusEl.innerText = status || 'しばらくお待ちください';
        if (barEl) barEl.style.width = '0%';
    },

    updateLoading: (status, percent) => {
        const statusEl = document.getElementById('loading-status');
        const barEl = document.getElementById('loading-bar');
        
        if (statusEl) statusEl.innerText = status;
        if (barEl) barEl.style.width = `${percent}%`;
    },

    hideLoading: () => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }
};
