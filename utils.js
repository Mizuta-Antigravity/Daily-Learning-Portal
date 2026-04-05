// Utility functions for CSV and DB
const Utils = {
    // CSV Parsing
    parseCSV: (text) => {
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const obj = {};
            headers.forEach((header, index) => {
                obj[header.trim()] = values[index] ? values[index].trim() : '';
            });
            return obj;
        });
    },

    // ---------------------------------------------------------
    // Firebase Data Access Methods
    // ---------------------------------------------------------

    saveFile: async (id, file, type, date) => {
        // 1. Upload file to Firebase Storage
        const fileRef = storage.ref().child(`files/${id}_${file.name}`);
        const snapshot = await fileRef.put(file);
        const downloadUrl = await snapshot.ref.getDownloadURL();
        
        // 2. Save metadata to Firestore
        await db.collection('files').doc(id).set({
            id: id,
            name: file.name,
            type: type,
            size: file.size || 0,
            date: date.id || date,
            url: downloadUrl,
            storagePath: `files/${id}_${file.name}`
        });
    },

    getFile: async (id) => {
        try {
            const doc = await db.collection('files').doc(id).get();
            if (!doc.exists) return null;
            return doc.data(); // Returns metadata including { name, url }
        } catch (e) {
            console.error('Error fetching file metadata:', e);
            return null;
        }
    },

    deleteFile: async (id) => {
        try {
            const doc = await db.collection('files').doc(id).get();
            if (doc.exists) {
                const data = doc.data();
                if (data.storagePath) {
                    await storage.ref().child(data.storagePath).delete();
                }
                await db.collection('files').doc(id).delete();
            }
        } catch (e) {
            console.error('Error deleting file:', e);
        }
    },

    getTotalStorageSize: async () => {
        try {
            const snapshot = await db.collection('files').get();
            let totalBytes = 0;
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.size) {
                    totalBytes += data.size;
                } else {
                    // Fallback for files saved before size tracking was added (assume 1.5MB avg PDF)
                    totalBytes += 1.5 * 1024 * 1024;
                }
            });
            // 1MB base for standard code files
            totalBytes += 1 * 1024 * 1024; 
            return totalBytes;
        } catch (e) {
            console.error('Error calculating storage size:', e);
            return 1 * 1024 * 1024;
        }
    },

    getAllSchedule: async () => {
        try {
            const snapshot = await db.collection('schedule').get();
            const results = [];
            snapshot.forEach(doc => results.push(doc.data()));
            return results;
        } catch (e) {
            console.error('Error fetching schedule:', e);
            return [];
        }
    },

    saveSchedule: async (data) => {
        const batch = db.batch();
        data.forEach(item => {
            const m = parseInt(item.月);
            const year = (m >= 1 && m <= 3) ? 2027 : 2026;
            const dateId = `${year}-${String(m).padStart(2,'0')}-${String(item.日).padStart(2,'0')}`;
            const docRef = db.collection('schedule').doc(dateId);
            batch.set(docRef, { ...item, id: dateId, 月: m, 日: parseInt(item.日) });
        });
        await batch.commit();
    },

    // Date Utils
    formatDate: (year, month, day) => {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },

    getWeekdayJP: (date) => {
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        return days[date.getDay()];
    },

    identifyPeriods: (schedule) => {
        if (!schedule || schedule.length === 0) return [];
        const academicSort = (a, b) => {
            const ma = parseInt(a.月), da = parseInt(a.日);
            const mb = parseInt(b.月), db = parseInt(b.日);
            const rankA = (ma >= 4 ? ma - 4 : ma + 8) * 100 + da;
            const rankB = (mb >= 4 ? mb - 4 : mb + 8) * 100 + db;
            return rankA - rankB;
        };
        const sorted = [...schedule].sort(academicSort);
        const periods = [];
        
        const findMarkers = (keyword) => sorted.filter(item => item.行事名 && item.行事名.includes(keyword));
        
        const startDates = {
            '1学期中間': findMarkers('始業式').find(i => parseInt(i.月) === 4)?.id,
            '1学期期末': null, // Will calculate from 1学期中間 end
            '2学期中間': findMarkers('始業式').find(i => parseInt(i.月) === 8 || parseInt(i.月) === 9)?.id,
            '2学期期末': null, // Will calculate from 2学期中間 end
            '3学期期末': findMarkers('始業式').find(i => parseInt(i.月) === 1)?.id,
        };

        const getEnd = (startDate, keyword) => {
            if (!startDate) return null;
            const startIdx = sorted.findIndex(i => i.id === startDate);
            if (startIdx === -1) return null;
            
            // Find the *first* occurrence of keyword after start date
            const firstExamIdx = sorted.findIndex((item, idx) => idx >= startIdx && (item.行事名 || '').includes(keyword));
            if (firstExamIdx === -1) return null;
            
            // Assume the exam period doesn't last more than 14 days from the first exam
            let lastExamIdx = firstExamIdx;
            const searchLimit = Math.min(sorted.length, firstExamIdx + 14);
            
            for (let i = firstExamIdx; i < searchLimit; i++) {
                const title = sorted[i].行事名 || '';
                if (title.includes(keyword)) {
                    lastExamIdx = i;
                }
            }
            
            // Extend to include home study days immediately following the last exam
            let endIdx = lastExamIdx;
            while (endIdx + 1 < sorted.length && (sorted[endIdx + 1].行事名 || '').includes('自宅学習日')) {
                endIdx++;
            }
            return sorted[endIdx].id;
        };

        // 1-Mid
        const end1Mid = getEnd(startDates['1学期中間'], '中間試験');
        periods.push({ name: '1学期中間', start: startDates['1学期中間'], end: end1Mid });

        // 1-Final
        if (end1Mid) {
            const nextIdx = sorted.findIndex(i => i.id === end1Mid) + 1;
            if (nextIdx < sorted.length) {
                const start1Final = sorted[nextIdx].id;
                const end1Final = getEnd(start1Final, '期末試験');
                periods.push({ name: '1学期期末', start: start1Final, end: end1Final });
            }
        }

        // 2-Mid
        const end2Mid = getEnd(startDates['2学期中間'], '中間試験');
        periods.push({ name: '2学期中間', start: startDates['2学期中間'], end: end2Mid });

        // 2-Final
        if (end2Mid) {
            const nextIdx = sorted.findIndex(i => i.id === end2Mid) + 1;
            if (nextIdx < sorted.length) {
                const start2Final = sorted[nextIdx].id;
                const end2Final = getEnd(start2Final, '期末試験');
                periods.push({ name: '2学期期末', start: start2Final, end: end2Final });
            }
        }

        // 3-Final
        const end3Final = getEnd(startDates['3学期期末'], '期末試験');
        periods.push({ name: '3学期期末', start: startDates['3学期期末'], end: end3Final });

        return periods.filter(p => p.start && p.end);
    },

    getCurrentPeriod: (periods, date) => {
        const dateStr = date.toISOString().split('T')[0];
        const current = periods.find(p => dateStr >= p.start && dateStr <= p.end);
        if (current) return current.name;
        
        // If not in a period, find the first period that hasn't started yet
        const next = periods.find(p => dateStr < p.start);
        if (next) return next.name;
        
        return periods.length > 0 ? periods[periods.length - 1].name : null;
    }
};
