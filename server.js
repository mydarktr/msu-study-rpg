require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini API için fetch kullanacağız (Google'ın resmi kütüphanesi yerine)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Veritabanı
const DB_DIR = './data';
const DB = {
    users: path.join(DB_DIR, 'users.json'),
    programs: path.join(DB_DIR, 'programs.json'),
    tasks: path.join(DB_DIR, 'tasks.json'),
    rewards: path.join(DB_DIR, 'rewards.json'),
    books: path.join(DB_DIR, 'books.json'),
    questions: path.join(DB_DIR, 'questions.json'),
    claims: path.join(DB_DIR, 'claims.json')
};

// ==================== YARDIMCI FONKSİYONLAR ====================

async function initDB() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        
        for (const file of Object.values(DB)) {
            try {
                await fs.access(file);
            } catch {
                await fs.writeFile(file, JSON.stringify([], null, 2));
            }
        }

        // Varsayılan kullanıcılar
        const users = await readFile(DB.users);
        
        if (!users.find(u => u.username === 'baba')) {
            users.push({
                id: uuidv4(),
                username: 'baba',
                password: 'admin123',
                role: 'admin',
                name: 'Baba',
                createdAt: new Date().toISOString()
            });
        }
        
        if (!users.find(u => u.username === 'ogrenci')) {
            users.push({
                id: uuidv4(),
                username: 'ogrenci',
                password: '123456',
                role: 'student',
                name: 'Öğrenci',
                points: 0,
                level: 1,
                totalStudyTime: 0,
                streak: 0,
                lastStudyDate: null,
                completedTasks: [],
                pendingRewards: [],
                weakTopics: [],
                createdAt: new Date().toISOString()
            });
        }
        
        await writeFile(DB.users, users);
        console.log('✅ Veritabanı hazır');
    } catch (error) {
        console.error('Veritabanı hatası:', error);
    }
}

async function readFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function writeFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// ==================== GEMINI AI FONKSİYONLARI ====================

async function generateWithGemini(prompt) {
    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2000,
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error('Gemini API Hatası:', data.error);
            return null;
        }

        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error('Gemini API Hatası:', error);
        return null;
    }
}

// MSÜ Odaklı Soru Üretme
async function generateMSUQuestion(subject, topic, difficulty) {
    const difficultyDesc = {
        1: "Temel kavramlar, doğrudan formül/kural uygulama",
        2: "2-3 adımlı düşünme, kavram birleştirme",
        3: "Çok adımlı, analiz gerektiren, MSÜ tarzı zor soru"
    };

    const prompt = `Sen MSÜ (Askeri Öğrenci Aday Belirleme Sınavı) ${subject} hazırlık uzmanısın. 
"${topic}" konusunda ${difficultyDesc[difficulty]} seviyede çoktan seçmeli soru hazırla.

MSÜ SORU ÖZELLİKLERİ:
- TYT'den biraz daha zor, pratik hayat odaklı
- Askeri/teknik mantık gerektirebilir
- 4 şık (A,B,C,D), doğru cevap rastgele yerleştirilmiş
- JSON formatında döndür

JSON FORMATI:
{
    "question": "Soru metni...",
    "options": ["A şıkkı", "B şıkkı", "C şıkkı", "D şıkkı"],
    "correctIndex": 0,
    "explanation": "Adım adım çözüm açıklaması...",
    "formula": "Kullanılan formül veya kural",
    "msuTip": "MSÜ'de dikkat edilmesi gereken nokta"
}`;

    const content = await generateWithGemini(prompt);
    if (!content) return null;

    try {
        // JSON'ı temizle ve parse et
        const jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
        const question = JSON.parse(jsonStr);

        return {
            id: uuidv4(),
            ...question,
            subject,
            topic,
            difficulty: parseInt(difficulty),
            examType: 'MSÜ',
            source: 'Gemini-AI',
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('JSON parse hatası:', error);
        return null;
    }
}

// MSÜ Odaklı Program Oluşturma
async function generateMSUProgram(subject, weakTopics, dailyHours, daysLeft) {
    const prompt = `MSÜ sınavına ${daysLeft} gün kalan bir öğrenci için ${subject} dersinde yoğunlaştırılmış çalışma programı oluştur.

ÖĞRENCİ PROFİLİ:
- Kalan Süre: ${daysLeft} gün
- Zayıf Konular: ${weakTopics.join(', ') || 'Belirtilmedi'}
- Günlük Çalışma: ${dailyHours} saat
- Hedef: MSÜ'de başarılı olmak

MSÜ STRATEJİSİ:
1. Önce zayıf konulara odaklan
2. Her gün mutlaka soru çözümü olsun
3. Tekrar ve pekiştirme süreleri ekle
4. Son günler genel tekrar ve deneme

HAFTALIK PROGRAM (JSON):
{
    "programName": "MSÜ ${subject} Yoğun Programı",
    "description": "Kısa sürede maksimum verim için AI destekli program",
    "strategy": "Genel strateji açıklaması",
    "schedule": [
        {
            "day": "Gün 1",
            "focus": "Odak konu",
            "tasks": [
                {
                    "title": "Görev adı",
                    "type": "video/question/theory",
                    "duration": 45,
                    "topic": "Konu",
                    "points": 50,
                    "resource": "Önerilen kaynak"
                }
            ]
        }
    ],
    "dailyPoints": 200,
    "totalPoints": 1400,
    "examTips": ["MSÜ ipucu 1", "ipucu 2"]
}`;

    const content = await generateWithGemini(prompt);
    if (!content) return null;

    try {
        const jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('Program parse hatası:', error);
        return null;
    }
}

// Motivasyon Mesajı
async function getGeminiMotivation(studentName, level, streak, isSuccess, daysLeft) {
    const prompt = `MSÜ'ye ${daysLeft} gün kaldı. Öğrenciye kısa motivasyon mesajı yaz:
- İsim: ${studentName}
- Seviye: ${level}
- Streak: ${streak} gün üst üste çalışma
- Son durum: ${isSuccess ? 'Başarılı' : 'Başarısız'}
- Kalan süre: ${daysLeft} gün

2 cümle, gaza getirici, askeri disiplin vurgusu yap, emoji kullan.`;

    const content = await generateWithGemini(prompt);
    return content || (isSuccess ? "Harika ilerliyorsun! MSÜ senin olacak! 🎯" : "Pes yok! Disiplinle devam! 💪");
}

// ==================== API ROUTES ====================

// Giriş
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await readFile(DB.users);
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Hatalı giriş bilgileri' });
    }

    if (user.role === 'student' && user.lastStudyDate) {
        const last = new Date(user.lastStudyDate);
        const today = new Date();
        const diffDays = Math.floor((today - last) / (1000 * 60 * 60 * 24));
        
        if (diffDays > 1) {
            user.streak = 0;
            const idx = users.findIndex(u => u.id === user.id);
            users[idx] = user;
            await writeFile(DB.users, users);
        }
    }

    res.json({ success: true, user: { ...user, password: undefined } });
});

// Öğrenci Bilgisi
app.get('/api/student/:id', async (req, res) => {
    const users = await readFile(DB.users);
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    res.json({ ...user, password: undefined });
});

// Tüm kullanıcılar (Admin için)
app.get('/api/admin/users', async (req, res) => {
    const users = await readFile(DB.users);
    res.json(users.map(u => ({ ...u, password: undefined })));
});

// GEMINI ile Soru Üret
app.post('/api/ai/generate-question', async (req, res) => {
    const { subject, topic, difficulty } = req.body;
    
    if (!subject || !topic || !difficulty) {
        return res.status(400).json({ message: 'Eksik bilgi' });
    }

    const question = await generateMSUQuestion(subject, topic, parseInt(difficulty));
    
    if (!question) {
        return res.status(500).json({ message: 'Soru üretilemedi' });
    }

    const questions = await readFile(DB.questions);
    questions.push(question);
    await writeFile(DB.questions, questions);

    res.json({ success: true, question });
});

// GEMINI ile Program Oluştur
app.post('/api/ai/generate-program', async (req, res) => {
    const { subject, weakTopics, dailyHours, daysLeft } = req.body;
    
    const aiData = await generateMSUProgram(subject, weakTopics || [], dailyHours || 4, daysLeft || 7);
    
    if (!aiData) {
        return res.status(500).json({ message: 'Program oluşturulamadı' });
    }

    const programs = await readFile(DB.programs);
    const program = {
        id: uuidv4(),
        name: aiData.programName,
        subject,
        description: aiData.description,
        strategy: aiData.strategy,
        isActive: true,
        aiGenerated: true,
        examType: 'MSÜ',
        daysLeft: daysLeft || 7,
        schedule: aiData.schedule,
        totalPoints: aiData.totalPoints,
        examTips: aiData.examTips,
        createdAt: new Date().toISOString()
    };
    
    programs.push(program);
    await writeFile(DB.programs, programs);

    // Görevleri de kaydet
    const tasks = await readFile(DB.tasks);
    aiData.schedule.forEach((day, index) => {
        day.tasks.forEach(task => {
            tasks.push({
                id: uuidv4(),
                programId: program.id,
                title: task.title,
                type: task.type,
                topic: task.topic,
                duration: task.duration,
                basePoints: task.points,
                day: day.day,
                dayNumber: index + 1,
                resource: task.resource,
                createdAt: new Date().toISOString()
            });
        });
    });
    await writeFile(DB.tasks, tasks);

    res.json({ success: true, program });
});

// Aktif Programlar
app.get('/api/programs/active', async (req, res) => {
    const programs = await readFile(DB.programs);
    const active = programs.filter(p => p.isActive);
    res.json(active);
});

// Programın Görevleri
app.get('/api/tasks/program/:programId', async (req, res) => {
    const tasks = await readFile(DB.tasks);
    const programTasks = tasks.filter(t => t.programId === req.params.programId);
    res.json(programTasks);
});

// AI Soruları Getir
app.get('/api/questions/ai', async (req, res) => {
    const { subject, difficulty, limit = 5 } = req.query;
    let questions = await readFile(DB.questions);
    
    if (subject) questions = questions.filter(q => q.subject === subject);
    if (difficulty) questions = questions.filter(q => q.difficulty == difficulty);
    
    questions = questions.filter(q => q.source === 'Gemini-AI');
    
    if (questions.length < limit) {
        const topics = {
            'Matematik': ['Sayı Basamakları', 'Bölme ve Bölünebilme', 'Rasyonel Sayılar', 'Ondalık Sayılar'],
            'Fizik': ['Madde ve Özellikleri', 'Hareket', 'Kuvvet', 'Enerji'],
            'Kimya': ['Kimya Bilimi', 'Atom', 'Periyodik Sistem', 'Kimyasal Türler']
        };
        
        const sub = subject || 'Matematik';
        const topic = topics[sub] ? topics[sub][Math.floor(Math.random() * topics[sub].length)] : 'Genel';
        const diff = difficulty || Math.floor(Math.random() * 3) + 1;
        
        const newQ = await generateMSUQuestion(sub, topic, diff);
        if (newQ) {
            const all = await readFile(DB.questions);
            all.push(newQ);
            await writeFile(DB.questions, all);
            questions.push(newQ);
        }
    }
    
    const shuffled = questions.sort(() => 0.5 - Math.random());
    res.json(shuffled.slice(0, parseInt(limit)));
});

// Soru Çözüm Kontrolü
app.post('/api/questions/check', async (req, res) => {
    const { questionId, answer } = req.body;
    const questions = await readFile(DB.questions);
    const question = questions.find(q => q.id === questionId);
    
    if (!question) return res.status(404).json({ message: 'Soru bulunamadı' });
    
    const isCorrect = answer === question.correctIndex;
    res.json({
        correct: isCorrect,
        correctAnswer: question.correctIndex,
        explanation: question.explanation,
        formula: question.formula,
        msuTip: question.msuTip,
        points: isCorrect ? question.difficulty * 2 : 0
    });
});

// Görev Tamamlama
app.post('/api/tasks/complete', async (req, res) => {
    const { userId, taskId, duration, netCount, correct, topic, daysLeft } = req.body;
    
    const users = await readFile(DB.users);
    const idx = users.findIndex(u => u.id === userId);
    
    if (idx === -1) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    
    const user = users[idx];
    
    let points = 0;
    if (netCount) points += netCount * 3;
    if (duration) points += Math.floor(duration / 10);
    if (correct) points += 5;
    
    const tasks = await readFile(DB.tasks);
    const task = tasks.find(t => t.id === taskId);
    if (task?.difficulty) points = Math.floor(points * task.difficulty);
    
    // MSÜ yaklaştıkça puan çarpanı (son günler daha değerli)
    const urgencyMultiplier = daysLeft ? (1 + (7 - Math.min(daysLeft, 7)) * 0.1) : 1;
    points = Math.floor(points * urgencyMultiplier);
    
    user.points += points;
    user.totalStudyTime += duration || 0;
    user.completedTasks.push({
        taskId,
        topic: topic || 'Genel',
        correct: correct || false,
        points,
        duration: duration || 0,
        completedAt: new Date().toISOString()
    });
    
    const today = new Date().toDateString();
    const last = user.lastStudyDate ? new Date(user.lastStudyDate).toDateString() : null;
    if (last !== today) {
        user.streak = (user.streak || 0) + 1;
        user.lastStudyDate = new Date().toISOString();
    }
    
    const newLevel = Math.floor(user.points / 500) + 1;
    const leveledUp = newLevel > user.level;
    user.level = newLevel;
    
    if (topic && !correct) {
        if (!user.weakTopics) user.weakTopics = [];
        if (!user.weakTopics.includes(topic)) user.weakTopics.push(topic);
    }
    
    users[idx] = user;
    await writeFile(DB.users, users);
    
    const motivation = await getGeminiMotivation(user.name, user.level, user.streak, correct, daysLeft || 7);
    
    res.json({
        success: true,
        pointsEarned: points,
        totalPoints: user.points,
        newLevel: user.level,
        leveledUp,
        streak: user.streak,
        motivation
    });
});

// Ödüller
app.get('/api/rewards', async (req, res) => {
    const rewards = await readFile(DB.rewards);
    res.json(rewards);
});

app.post('/api/admin/rewards', async (req, res) => {
    const { name, cost, description, icon } = req.body;
    
    const rewards = await readFile(DB.rewards);
    rewards.push({
        id: uuidv4(),
        name,
        cost: parseInt(cost),
        description,
        icon: icon || '🎁',
        createdAt: new Date().toISOString()
    });
    
    await writeFile(DB.rewards, rewards);
    res.json({ success: true });
});

// Ödül Talep
app.post('/api/rewards/claim', async (req, res) => {
    const { userId, rewardId } = req.body;
    
    const users = await readFile(DB.users);
    const rewards = await readFile(DB.rewards);
    
    const userIdx = users.findIndex(u => u.id === userId);
    const reward = rewards.find(r => r.id === rewardId);
    
    if (userIdx === -1 || !reward) {
        return res.status(404).json({ message: 'Bulunamadı' });
    }
    
    if (users[userIdx].points < reward.cost) {
        return res.status(400).json({ message: 'Yetersiz puan' });
    }
    
    const claim = {
        id: uuidv4(),
        userId,
        rewardId,
        rewardName: reward.name,
        cost: reward.cost,
        status: 'pending',
        requestedAt: new Date().toISOString()
    };
    
    if (!users[userIdx].pendingRewards) users[userIdx].pendingRewards = [];
    users[userIdx].pendingRewards.push(claim);
    await writeFile(DB.users, users);
    
    const claims = await readFile(DB.claims);
    claims.push(claim);
    await writeFile(DB.claims, claims);
    
    res.json({ success: true, message: 'Talep gönderildi! Baban onaylayacak.', claim });
});

// Admin: Bekleyen Talepler
app.get('/api/admin/claims', async (req, res) => {
    const claims = await readFile(DB.claims);
    const users = await readFile(DB.users);
    
    const pending = claims
        .filter(c => c.status === 'pending')
        .map(c => {
            const user = users.find(u => u.id === c.userId);
            return {
                ...c,
                username: user?.name || 'Bilinmiyor',
                userPoints: user?.points || 0
            };
        });
    
    res.json(pending);
});

// Admin: Talep İşle
app.post('/api/admin/claims/:claimId', async (req, res) => {
    const { claimId } = req.params;
    const { status, userId } = req.body;
    
    const users = await readFile(DB.users);
    const claims = await readFile(DB.claims);
    
    const userIdx = users.findIndex(u => u.id === userId);
    const claimIdx = claims.findIndex(c => c.id === claimId);
    
    if (userIdx === -1 || claimIdx === -1) {
        return res.status(404).json({ message: 'Bulunamadı' });
    }
    
    const claim = claims[claimIdx];
    claim.status = status;
    claim.processedAt = new Date().toISOString();
    
    if (status === 'approved') {
        users[userIdx].points -= claim.cost;
        users[userIdx].pendingRewards = users[userIdx].pendingRewards.filter(p => p.id !== claimId);
    }
    
    await writeFile(DB.users, users);
    await writeFile(DB.claims, claims);
    
    res.json({ success: true, message: status === 'approved' ? 'Onaylandı' : 'Reddedildi' });
});

// Zayıf Konular
app.get('/api/student/:id/weak-topics', async (req, res) => {
    const users = await readFile(DB.users);
    const user = users.find(u => u.id === req.params.id);
    
    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    
    const stats = {};
    (user.completedTasks || []).forEach(task => {
        if (!task.topic) return;
        if (!stats[task.topic]) stats[task.topic] = { correct: 0, total: 0 };
        stats[task.topic].total++;
        if (task.correct) stats[task.topic].correct++;
    });
    
    const weak = Object.entries(stats)
        .filter(([_, s]) => s.total > 0 && (s.correct / s.total) < 0.6)
        .map(([topic]) => topic);
    
    res.json({ weakTopics: weak });
});

// Admin: Program Ekle
app.post('/api/admin/programs', async (req, res) => {
    const { name, subject, description, useAI, weakTopics, dailyHours, daysLeft } = req.body;
    
    if (useAI) {
        const aiData = await generateMSUProgram(subject, weakTopics || [], dailyHours || 4, daysLeft || 7);
        if (!aiData) return res.status(500).json({ message: 'AI hatası' });
        
        const programs = await readFile(DB.programs);
        const program = {
            id: uuidv4(),
            name: aiData.programName,
            subject,
            description: aiData.description,
            strategy: aiData.strategy,
            isActive: true,
            aiGenerated: true,
            examType: 'MSÜ',
            daysLeft: daysLeft || 7,
            schedule: aiData.schedule,
            totalPoints: aiData.totalPoints,
            examTips: aiData.examTips,
            createdAt: new Date().toISOString()
        };
        programs.push(program);
        await writeFile(DB.programs, programs);
        
        // Görevleri kaydet
        const tasks = await readFile(DB.tasks);
        aiData.schedule.forEach((day, idx) => {
            day.tasks.forEach(task => {
                tasks.push({
                    id: uuidv4(),
                    programId: program.id,
                    title: task.title,
                    type: task.type,
                    topic: task.topic,
                    duration: task.duration,
                    basePoints: task.points,
                    day: day.day,
                    dayNumber: idx + 1,
                    resource: task.resource,
                    createdAt: new Date().toISOString()
                });
            });
        });
        await writeFile(DB.tasks, tasks);
        
        return res.json({ success: true, program, aiGenerated: true });
    }
    
    // Manuel
    const programs = await readFile(DB.programs);
    const program = {
        id: uuidv4(),
        name,
        subject,
        description,
        isActive: true,
        aiGenerated: false,
        createdAt: new Date().toISOString()
    };
    programs.push(program);
    await writeFile(DB.programs, programs);
    
    res.json({ success: true, program });
});

// Admin: Görev Ekle
app.post('/api/admin/tasks', async (req, res) => {
    const { title, type, duration, basePoints, difficulty } = req.body;
    
    const tasks = await readFile(DB.tasks);
    tasks.push({
        id: uuidv4(),
        title,
        type,
        duration,
        basePoints,
        difficulty: difficulty || 1,
        createdAt: new Date().toISOString()
    });
    
    await writeFile(DB.tasks, tasks);
    res.json({ success: true });
});

// Kitap Ekle
app.post('/api/admin/books', async (req, res) => {
    const { title, author, subject, totalPages } = req.body;
    
    const books = await readFile(DB.books);
    books.push({
        id: uuidv4(),
        title,
        author,
        subject,
        totalPages: parseInt(totalPages),
        currentPage: 0,
        addedAt: new Date().toISOString()
    });
    
    await writeFile(DB.books, books);
    res.json({ success: true });
});

// Statik Dosyalar
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Sunucuyu Başlat
app.listen(PORT, '0.0.0.0', async () => {
    await initDB();
    console.log(`
    🎯 MSÜ HAZIRLIK - STUDY RPG BAŞLADI!
    =====================================
    🌐 Bilgisayarın: http://localhost:${PORT}
    📱 Aynı WiFi'den: http://${getLocalIP()}:${PORT}
    
    🔑 Giriş Bilgileri:
    Admin (Baba):  baba / admin123
    Öğrenci:       ogrenci / 123456
    
    🤖 Gemini AI Aktif!
    🎯 MSÜ Odaklı!
    
    📱 Babanın Erişimi:
    Aynı WiFi'ye bağlı telefondan:
    http://${getLocalIP()}:${PORT}
    adresine girsin, "Admin" seçeneğini seçip
    baba / admin123 ile giriş yapsın.
    `);
});