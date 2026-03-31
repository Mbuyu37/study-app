/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, FormEvent } from 'react';
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { Toaster, toast } from 'sonner';
import { 
  Send, 
  Bot, 
  User, 
  BookOpen, 
  GraduationCap, 
  Loader2, 
  Trash2, 
  Sparkles, 
  Clock, 
  CheckCircle, 
  LogIn, 
  LogOut, 
  Settings, 
  Bell, 
  Target, 
  Brain, 
  X,
  Flame,
  Trophy,
  CheckCircle2,
  Shield,
  FileText,
  RotateCcw,
  Upload,
  Moon,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp, getDocs, doc, getDocFromServer, writeBatch, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  userId?: string;
}

interface SubjectStats {
  xp: number;
  level: number;
  badges: string[];
  studyStreak: number;
  lastStudyDate: string;
  quizHighScores: Record<string, number>; // difficulty -> high score
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface Quiz {
  id: string;
  subject: string;
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  questions: QuizQuestion[];
  createdAt: Date;
}

interface StudyFile {
  id: string;
  name: string;
  content: string;
  type: string;
  uploadedAt: Date;
  userId: string;
}

interface UserStats {
  streak: number;
  weeklyHours: number;
  todayHours: number;
  level: number;
  xp: number;
  focusScore: number;
  sessionsCompleted: number;
  mostStudiedSubject: string;
  lastActiveDate: string;
  subjectStats: Record<string, SubjectStats>;
  totalQuizzesTaken: number;
  averageQuizScore: number;
}

interface UserSettings {
  displayName: string;
  studyMethod: string;
  notificationsEnabled: boolean;
  dailyGoal: number;
  reminderTime: string; // HH:mm format
  blockedApps: string[];
  allowedTools: string[];
  subjects: string[];
  theme: 'light' | 'dark';
  stats: UserStats;
}

const DEFAULT_STATS: UserStats = {
  streak: 0,
  weeklyHours: 0,
  todayHours: 0,
  level: 1,
  xp: 0,
  focusScore: 0,
  sessionsCompleted: 0,
  mostStudiedSubject: 'None',
  lastActiveDate: new Date().toISOString().split('T')[0],
  subjectStats: {},
  totalQuizzesTaken: 0,
  averageQuizScore: 0,
};

const DEFAULT_SETTINGS: UserSettings = {
  displayName: '',
  studyMethod: 'Pomodoro',
  notificationsEnabled: true,
  dailyGoal: 2,
  reminderTime: '09:00',
  blockedApps: ['Instagram', 'TikTok', 'YouTube', 'Twitter'],
  allowedTools: ['Notion', 'Google Docs', 'Calculator', 'PDF Reader'],
  subjects: ['Mathematics', 'History', 'Science', 'Literature'],
  theme: 'dark',
  stats: DEFAULT_STATS,
};

const MOTIVATIONAL_QUOTES = [
  "The secret of getting ahead is getting started.",
  "It always seems impossible until it's done.",
  "Don't watch the clock; do what it does. Keep going.",
  "Success is the sum of small efforts, repeated day in and day out.",
  "Your education is a dress rehearsal for a life that is yours to lead.",
  "The expert in anything was once a beginner.",
  "Believe you can and you're halfway there.",
  "Hard work beats talent when talent doesn't work hard.",
];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const MOTIVATIONAL_MESSAGES = [
  "Stay focused, you got this!",
  "Small steps lead to big results.",
  "Your future self will thank you.",
  "Focus on being productive, not busy.",
  "The only way to do great work is to love what you do.",
  "Success is the sum of small efforts repeated daily.",
  "Don't stop until you're proud.",
  "Believe in yourself and all that you are.",
  "Your mind is a powerful thing. Fill it with positive thoughts.",
  "The secret of getting ahead is getting started."
];

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [selectedSubject, setSelectedSubject] = useState<string>('Mathematics');
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Quiz State
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [isQuizFinished, setIsQuizFinished] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDifficulty, setQuizDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [quizTopic, setQuizTopic] = useState('');
  const [quizNotes, setQuizNotes] = useState('');
  
  // File Upload State
  const [studyFiles, setStudyFiles] = useState<StudyFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  
  // Summarizer State
  const [isSummarizerModalOpen, setIsSummarizerModalOpen] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryResult, setSummaryResult] = useState('');
  const [summaryType, setSummaryType] = useState<'Bullet Points' | 'Key Concepts' | 'Flashcards'>('Bullet Points');
  const [summaryNotes, setSummaryNotes] = useState('');
  const [summaryTopic, setSummaryTopic] = useState('');
  
  // Timer State
  const [sessionDuration, setSessionDuration] = useState(25); // Default 25 mins
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [timerMode, setTimerMode] = useState<'Pomodoro' | 'Deep Study' | 'Custom'>('Pomodoro');
  const [isSessionSetupOpen, setIsSessionSetupOpen] = useState(false);
  const [sessionTopic, setSessionTopic] = useState('');
  const [sessionGoal, setSessionGoal] = useState('');
  const [motivationalMessage, setMotivationalMessage] = useState('Stay focused, you got this!');
  const [isBreak, setIsBreak] = useState(false);
  
  // Smart Exit Check State
  const [isSmartExitModalOpen, setIsSmartExitModalOpen] = useState(false);
  const [exitQuizQuestions, setExitQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentExitQuizIndex, setCurrentExitQuizIndex] = useState(0);
  const [isGeneratingExitQuiz, setIsGeneratingExitQuiz] = useState(false);
  const [exitQuizScore, setExitQuizScore] = useState(0);
  const [isExitQuizCompleted, setIsExitQuizCompleted] = useState(false);
  const [selectedExitOption, setSelectedExitOption] = useState<number | null>(null);
  const [showExitExplanation, setShowExitExplanation] = useState(false);
  const [exitReason, setExitReason] = useState<'quit' | 'finish'>('quit');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Theme Logic
  useEffect(() => {
    if (userSettings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [userSettings.theme]);

  // Timer Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev % 60 === 0 && prev !== sessionDuration * 60) {
            setMotivationalMessage(MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)]);
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timeLeft === 0 && isTimerActive) {
      setIsTimerRunning(false);
      setIsTimerActive(false);
      
      if (isBreak) {
        toast.success("Break finished! Ready to focus again?", {
          icon: <Sparkles className="w-5 h-5 text-indigo-500" />
        });
        setIsBreak(false);
        // Reset to session duration
        setTimeLeft(sessionDuration * 60);
      } else {
        // Handle session completion
        if (user) {
          const sessionHours = sessionDuration / 60;
          const today = new Date().toISOString().split('T')[0];
          const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
          
          // Global Stats
          const newXp = userSettings.stats.xp + 50;
          const newSessions = userSettings.stats.sessionsCompleted + 1;
          const newTodayHours = userSettings.stats.todayHours + sessionHours;
          const newWeeklyHours = userSettings.stats.weeklyHours + sessionHours;

          // Subject Stats
          const subject = selectedSubject;
          const currentSubjectStats = userSettings.stats.subjectStats[subject] || {
            xp: 0,
            level: 1,
            badges: [],
            studyStreak: 0,
            lastStudyDate: '',
            quizHighScores: {}
          };

          let newSubjectStreak = currentSubjectStats.studyStreak;
          if (currentSubjectStats.lastStudyDate === yesterday) {
            newSubjectStreak += 1;
          } else if (currentSubjectStats.lastStudyDate !== today) {
            newSubjectStreak = 1;
          }

          const streakBonus = newSubjectStreak >= 3 ? 25 : 0;
          const newSubjectXp = currentSubjectStats.xp + 50 + streakBonus;
          const newSubjectLevel = Math.floor(newSubjectXp / 100) + 1;

          // Badge logic
          const newBadges = [...currentSubjectStats.badges];
          if (newSubjectLevel >= 5 && !newBadges.includes(`${subject} Expert`)) {
            newBadges.push(`${subject} Expert`);
            toast.success(`Badge Earned: ${subject} Expert!`, {
              description: `You've reached level 5 in ${subject}.`,
              icon: <Trophy className="w-5 h-5 text-yellow-500" />,
            });
          }
          if (newSubjectStreak >= 7 && !newBadges.includes(`${subject} Dedicated`)) {
            newBadges.push(`${subject} Dedicated`);
            toast.success(`Badge Earned: ${subject} Dedicated!`, {
              description: `You've studied ${subject} for 7 days in a row.`,
              icon: <Trophy className="w-5 h-5 text-yellow-500" />,
            });
          }

          const updatedSubjectStats = {
            ...userSettings.stats.subjectStats,
            [subject]: {
              ...currentSubjectStats,
              xp: newSubjectXp,
              level: newSubjectLevel,
              studyStreak: newSubjectStreak,
              lastStudyDate: today,
              badges: newBadges,
              quizHighScores: currentSubjectStats.quizHighScores || {}
            }
          };

          // Determine most studied subject
          let mostStudied = userSettings.stats.mostStudiedSubject;
          let maxXP = 0;
          Object.entries(updatedSubjectStats).forEach(([name, stats]) => {
            const s = stats as SubjectStats;
            if (s.xp > maxXP) {
              maxXP = s.xp;
              mostStudied = name;
            }
          });

          updateSettings({
            stats: {
              ...userSettings.stats,
              xp: newXp,
              sessionsCompleted: newSessions,
              todayHours: newTodayHours,
              weeklyHours: newWeeklyHours,
              level: Math.floor(newXp / 100) + 1,
              subjectStats: updatedSubjectStats,
              mostStudiedSubject: mostStudied
            }
          });

          if (userSettings.notificationsEnabled) {
            toast.success("Session completed!", {
              description: `You've earned 50 XP in ${subject}${streakBonus > 0 ? ` + ${streakBonus} streak bonus!` : ''}`,
              icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
            });

            // Check for goal completion
            if (newTodayHours >= userSettings.dailyGoal && userSettings.stats.todayHours < userSettings.dailyGoal) {
              toast.success("Daily Goal Reached!", {
                description: `Congratulations! You've reached your goal of ${userSettings.dailyGoal} hours today.`,
                icon: <Trophy className="w-5 h-5 text-yellow-500" />,
                duration: 5000,
              });
            }
          }

          // Automatically start break if in Pomodoro or Deep Study mode
          if (timerMode === 'Pomodoro') {
            setIsBreak(true);
            setTimeLeft(5 * 60);
            setIsTimerRunning(true);
            setIsTimerActive(true);
            toast.info("Time for a 5-minute break!");
          } else if (timerMode === 'Deep Study') {
            setIsBreak(true);
            setTimeLeft(10 * 60);
            setIsTimerRunning(true);
            setIsTimerActive(true);
            toast.info("Time for a 10-minute break!");
          }
        }
      }
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timeLeft, user, sessionDuration, userSettings, selectedSubject, timerMode, isBreak, isTimerActive]);

  const startTimer = () => {
    setTimeLeft(sessionDuration * 60);
    setIsTimerRunning(true);
    setIsTimerActive(true);
    setIsSessionSetupOpen(false);
    setInput(`I'm starting a ${sessionDuration} minute study session on ${sessionTopic} (${selectedSubject}). My goal is: ${sessionGoal}. Let's focus!`);
  };

  const toggleTimer = () => setIsTimerRunning(!isTimerRunning);

  const resetTimer = () => {
    setIsTimerRunning(false);
    setIsTimerActive(false);
    setIsBreak(false);
    setTimeLeft(sessionDuration * 60);
    setSessionTopic('');
    setSessionGoal('');
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTimerActive && !isBreak) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isTimerActive, isBreak]);

  const handleExitAttempt = async (reason: 'quit' | 'finish') => {
    if (isBreak) {
      if (reason === 'finish') setTimeLeft(0);
      else resetTimer();
      return;
    }
    
    setExitReason(reason);
    setIsTimerRunning(false);
    setIsSmartExitModalOpen(true);
    setIsGeneratingExitQuiz(true);
    setExitQuizQuestions([]);
    setCurrentExitQuizIndex(0);
    setExitQuizScore(0);
    setIsExitQuizCompleted(false);
    setSelectedExitOption(null);
    setShowExitExplanation(false);

    try {
      const prompt = `Generate a very short 3-question quiz (multiple choice) based on the study topic: "${sessionTopic}" and goal: "${sessionGoal}". 
      The goal is to check if the user learned anything before they ${reason === 'finish' ? 'finish' : 'quit'} their study session early.
      Return ONLY a JSON array of 3 questions with this structure:
      [
        {
          "question": "string",
          "options": ["string", "string", "string", "string"],
          "correctAnswer": number (0-3),
          "explanation": "string"
        }
      ]`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const questions = JSON.parse(response.text);
      setExitQuizQuestions(questions);
    } catch (err) {
      console.error("Exit quiz generation error:", err);
      toast.error("Failed to generate exit quiz. You can still proceed.");
    } finally {
      setIsGeneratingExitQuiz(false);
    }
  };

  const handleExitQuizAnswer = (optionIndex: number) => {
    if (selectedExitOption !== null) return;
    
    setSelectedExitOption(optionIndex);
    setShowExitExplanation(true);
    
    if (optionIndex === exitQuizQuestions[currentExitQuizIndex].correctAnswer) {
      setExitQuizScore(prev => prev + 1);
    }
  };

  const nextExitQuestion = () => {
    if (currentExitQuizIndex < exitQuizQuestions.length - 1) {
      setCurrentExitQuizIndex(prev => prev + 1);
      setSelectedExitOption(null);
      setShowExitExplanation(false);
    } else {
      setIsExitQuizCompleted(true);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const content = event.target?.result as string;
        const fileData = {
          name: file.name,
          type: file.type,
          content: content.substring(0, 500000), // Limit content size for Firestore
          uploadedAt: serverTimestamp(),
          userId: user.uid
        };
        await addDoc(collection(db, 'studyFiles'), fileData);
        toast.success("File uploaded successfully!");
        setIsUploading(false);
      };
      reader.readAsText(file);
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Failed to upload file.");
      setIsUploading(false);
    }
  };

  const generateQuiz = async () => {
    if (!user || (!quizTopic && !quizNotes)) {
      toast.error("Please provide a topic or notes.");
      return;
    }

    setIsGeneratingQuiz(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.INTEGER, description: "Index of the correct option (0-3)" },
                    explanation: { type: Type.STRING }
                  },
                  required: ["question", "options", "correctAnswer", "explanation"]
                }
              }
            },
            required: ["questions"]
          }
        },
        contents: `Generate a ${quizDifficulty} difficulty quiz about ${quizTopic || 'the provided notes'}. 
        Subject: ${selectedSubject}.
        Notes: ${quizNotes.substring(0, 5000)}.
        Provide 5 multiple-choice questions with 4 options each. 
        Include a clear explanation for each answer.`
      });

      const result = await model;
      const quizData = JSON.parse(result.text);
      
      setCurrentQuiz({
        id: Date.now().toString(),
        subject: selectedSubject,
        topic: quizTopic || 'Custom Notes',
        difficulty: quizDifficulty,
        questions: quizData.questions,
        createdAt: new Date()
      });
      setQuizAnswers(new Array(quizData.questions.length).fill(-1));
      setIsQuizFinished(false);
      setQuizScore(0);
      setIsQuizModalOpen(true);
    } catch (err) {
      console.error("Quiz generation error:", err);
      toast.error("Failed to generate quiz. Please try again.");
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const submitQuiz = async () => {
    if (!currentQuiz || !user) return;

    let score = 0;
    currentQuiz.questions.forEach((q, i) => {
      if (quizAnswers[i] === q.correctAnswer) score++;
    });

    const finalScore = (score / currentQuiz.questions.length) * 100;
    setQuizScore(finalScore);
    setIsQuizFinished(true);

    // Update Stats
    const subject = currentQuiz.subject;
    const currentSubjectStats = userSettings.stats.subjectStats[subject] || {
      xp: 0,
      level: 1,
      badges: [],
      studyStreak: 0,
      lastStudyDate: '',
      quizHighScores: {}
    };

    const oldHighScore = currentSubjectStats.quizHighScores?.[currentQuiz.difficulty] || 0;
    const newHighScore = Math.max(oldHighScore, finalScore);
    
    // XP for taking quiz
    const xpEarned = 20 + (score * 10); // 20 base + 10 per correct answer
    const newTotalXp = userSettings.stats.xp + xpEarned;
    
    const updatedSubjectStats = {
      ...userSettings.stats.subjectStats,
      [subject]: {
        ...currentSubjectStats,
        xp: currentSubjectStats.xp + xpEarned,
        quizHighScores: {
          ...currentSubjectStats.quizHighScores,
          [currentQuiz.difficulty]: newHighScore
        }
      }
    };

    updateSettings({
      stats: {
        ...userSettings.stats,
        xp: newTotalXp,
        totalQuizzesTaken: userSettings.stats.totalQuizzesTaken + 1,
        averageQuizScore: (userSettings.stats.averageQuizScore * userSettings.stats.totalQuizzesTaken + finalScore) / (userSettings.stats.totalQuizzesTaken + 1),
        subjectStats: updatedSubjectStats
      }
    });

    toast.success(`Quiz Finished! Score: ${finalScore}%`, {
      description: `You earned ${xpEarned} XP!`,
      icon: <Trophy className="w-5 h-5 text-yellow-500" />
    });
  };

  const summarizeNotes = async () => {
    if (!user || (!summaryTopic && !summaryNotes)) {
      toast.error("Please provide a topic or notes.");
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Summarize the following notes into ${summaryType}. 
        Topic: ${summaryTopic || 'General'}.
        Subject: ${selectedSubject}.
        Notes: ${summaryNotes.substring(0, 10000)}.
        
        Format the output clearly. If flashcards, use "Q: [Question] \n A: [Answer]" format.`
      });

      const result = await model;
      setSummaryResult(result.text || "Failed to generate summary.");
      setIsSummarizerModalOpen(true);
      
      // Award some XP for summarizing
      const xpEarned = 15;
      updateSettings({
        stats: {
          ...userSettings.stats,
          xp: userSettings.stats.xp + xpEarned
        }
      });
      
      toast.success("Summary generated!", {
        description: `You earned ${xpEarned} XP!`,
        icon: <Sparkles className="w-5 h-5 text-indigo-500" />
      });
    } catch (err) {
      console.error("Summarization error:", err);
      toast.error("Failed to generate summary. Please try again.");
    } finally {
      setIsGeneratingSummary(false);
    }
  };
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Notification Effect for Streaks and Reminders
  useEffect(() => {
    if (!user || !userSettings.notificationsEnabled) return;

    const checkNotifications = () => {
      const today = new Date().toISOString().split('T')[0];
      const lastActive = userSettings.stats.lastActiveDate;

      // Streak Notification
      if (userSettings.stats.streak > 0 && userSettings.stats.streak % 5 === 0 && lastActive !== today) {
        toast("Streak Milestone!", {
          description: `You're on a ${userSettings.stats.streak} day streak! Keep the momentum going.`,
          icon: <Flame className="w-5 h-5 text-orange-500" />,
        });
      }

      // Reminder if not active today
      if (lastActive !== today) {
        const [reminderHour, reminderMin] = userSettings.reminderTime.split(':').map(Number);
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();

        if (hour === reminderHour && Math.abs(min - reminderMin) < 5) {
          toast("Time to Study?", {
            description: "Start your first session of the day to keep your streak alive!",
            icon: <Bell className="w-5 h-5 text-indigo-500" />,
          });
        }
      }
    };

    checkNotifications();
  }, [user, userSettings.notificationsEnabled, userSettings.stats.streak, userSettings.stats.lastActiveDate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2500);
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'messages'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          role: data.role,
          content: data.content,
          timestamp: data.timestamp?.toDate() || new Date(),
          userId: data.userId
        } as Message;
      });
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setStudyFiles([]);
      return;
    }

    const q = query(
      collection(db, 'studyFiles'),
      where('userId', '==', user.uid),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const files = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          uploadedAt: data.uploadedAt?.toDate() || new Date()
        } as StudyFile;
      });
      setStudyFiles(files);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'studyFiles');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUserSettings(DEFAULT_SETTINGS);
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserSettings({
          ...DEFAULT_SETTINGS,
          ...data,
          stats: {
            ...DEFAULT_STATS,
            ...(data.stats || {})
          }
        } as UserSettings);
      } else {
        // Initialize default settings if they don't exist
        const initialSettings = {
          ...DEFAULT_SETTINGS,
          displayName: user.displayName || 'Student',
          updatedAt: serverTimestamp()
        };
        setDoc(userDocRef, initialSettings).catch(err => {
          console.error("Error initializing settings:", err);
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleLogin = (mode: 'signin' | 'signup' = 'signin') => {
    setIsAuthModalOpen(true);
    setAuthMode(mode);
  };

  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      setIsAuthModalOpen(false);
      setError(null);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        return;
      }
      console.error("Login error:", error);
      setError("Failed to sign in. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);

    try {
      if (authMode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
          await updateProfile(userCredential.user, { displayName });
        }
        toast.success("Account created successfully!");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success("Signed in successfully!");
      }
      setIsAuthModalOpen(false);
      setEmail('');
      setPassword('');
      setDisplayName('');
    } catch (error: any) {
      console.error("Auth error:", error);
      if (error.code === 'auth/email-already-in-use') {
        setError("This email is already in use.");
      } else if (error.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else if (error.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else {
        setError("Authentication failed. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setError(null);
    } catch (error) {
      console.error("Logout error:", error);
      setError("Failed to sign out. Please try again.");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !user) return;

    const userContent = input.trim();
    
    // Focus Protocol Enforcement
    if (isTimerRunning) {
      const mentionedBlocked = userSettings.blockedApps.find(app => 
        userContent.toLowerCase().includes(app.toLowerCase())
      );
      if (mentionedBlocked) {
        toast.error("Focus Protocol Violation!", {
          description: `You're currently in a study session. Remember that ${mentionedBlocked} is on your blocked list. Stay focused!`,
          icon: <Shield className="w-5 h-5 text-red-500" />,
        });
      }
    }

    setInput('');
    setIsLoading(true);

    try {
      // Save user message to Firestore
      await addDoc(collection(db, 'messages'), {
        id: Date.now().toString(),
        role: 'user',
        content: userContent,
        timestamp: serverTimestamp(),
        userId: user.uid
      });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [...messages, { role: 'user', content: userContent }].map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: `You are 'Study Focus', an expert academic assistant. Your goal is to help students learn, summarize complex topics, solve problems step-by-step, and provide study tips. 
          The user's preferred study method is: ${userSettings.studyMethod}. 
          Adapt your explanations and suggestions to align with this method when appropriate. 
          
          Current Focus Protocol:
          - Allowed Tools: ${userSettings.allowedTools.join(', ')}
          - Blocked Distractions: ${userSettings.blockedApps.join(', ')}
          
          If the user asks about a blocked distraction during a study session, gently remind them of their commitment to focus. 
          Encourage the use of the allowed tools for their current task.
          Be encouraging, precise, and educational.`,
        }
      });

      const assistantContent = response.text || "I'm sorry, I couldn't generate a response.";

      // Save assistant message to Firestore
      await addDoc(collection(db, 'messages'), {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantContent,
        timestamp: serverTimestamp(),
        userId: user.uid
      });

      setError(null);
    } catch (err) {
      console.error("Error generating content:", err);
      setError("Failed to generate response. Please check your connection and try again.");
      try {
        handleFirestoreError(err, OperationType.WRITE, 'messages');
      } catch (e) {
        // Error already logged by handleFirestoreError
      }
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    if (!user) return;
    
    try {
      const q = query(collection(db, 'messages'), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setIsConfirmingClear(false);
        return;
      }

      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      setIsConfirmingClear(false);
    } catch (error) {
      console.error("Error clearing chat:", error);
      handleFirestoreError(error, OperationType.DELETE, 'messages');
    }
  };

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    if (!user) return;
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        ...userSettings,
        ...newSettings,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setError(null);
    } catch (err) {
      console.error("Error updating settings:", err);
      setError("Failed to save settings. Please try again.");
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  return (
    <div className={`flex flex-col h-screen ${userSettings.theme === 'dark' ? 'bg-[#0a0a0a] text-zinc-100' : 'bg-zinc-50 text-zinc-900'} font-sans selection:bg-indigo-500/30 overflow-hidden transition-colors duration-500`}>
      <Toaster position="top-right" theme={userSettings.theme} richColors closeButton />
      
      {/* Focus Mode Overlay */}
      <AnimatePresence>
        {isTimerRunning && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] pointer-events-none"
          >
            <div className="absolute inset-0 bg-indigo-600/5 backdrop-blur-[1px]" />
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-pulse" />
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-900/90 border border-indigo-500/30 rounded-full flex items-center gap-3 shadow-2xl backdrop-blur-md pointer-events-auto">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-400" />
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">Focus Protocol Active</span>
              </div>
              <div className="h-4 w-px bg-zinc-800" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 uppercase font-bold">Blocked:</span>
                <div className="flex gap-1">
                  {userSettings.blockedApps.slice(0, 2).map((app, i) => (
                    <span key={i} className="text-[10px] text-red-400 font-medium">{app}</span>
                  ))}
                  {userSettings.blockedApps.length > 2 && <span className="text-[10px] text-zinc-600">...</span>}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {showSplash ? (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className={`fixed inset-0 z-[100] ${userSettings.theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-white'} flex flex-col items-center justify-center transition-colors duration-500`}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="relative">
                <div className="w-24 h-24 rounded-[2.5rem] bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-[0_0_50px_rgba(79,70,229,0.3)]">
                  <GraduationCap className="w-12 h-12 text-white" />
                </div>
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2, ease: "easeInOut" }}
                  className="absolute -bottom-8 left-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"
                />
              </div>
              <div className="text-center">
                <motion.h1 
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.8 }}
                  className="text-4xl font-serif italic font-bold text-white tracking-tight"
                >
                  Study Focus
                </motion.h1>
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1, duration: 0.8 }}
                  className="text-zinc-500 text-sm font-medium uppercase tracking-[0.3em] mt-2"
                >
                  Deep Learning Companion
                </motion.p>
              </div>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div 
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col h-full w-full"
          >
            {/* Header */}
            <header className={`flex items-center justify-between px-6 py-4 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800/50 bg-[#0a0a0a]/80' : 'border-zinc-200 bg-white/80'} backdrop-blur-md sticky top-0 z-10 transition-colors duration-500`}>
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/50 rotate-3 group-hover:rotate-0 transition-transform duration-300">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-indigo-600' : 'bg-white border-indigo-500'} border-2 flex items-center justify-center`}>
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            </div>
          </div>
          <div>
            <h1 className={`text-2xl font-serif italic font-semibold tracking-tight ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'} leading-none mb-1`}>Study Focus</h1>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${user ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-[0.2em]">{user ? 'Active Session' : 'Offline'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isTimerActive && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl shadow-lg"
            >
              <div className="flex flex-col items-end">
                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">Session Time</span>
                <span className={`text-sm font-mono font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-indigo-400'}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-3">
                <button 
                  onClick={toggleTimer}
                  className="p-1 text-zinc-400 hover:text-white transition-colors"
                >
                  {isTimerRunning ? <X className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                </button>
                <button 
                  onClick={resetTimer}
                  className="p-1 text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
          {user ? (
            <div className="flex items-center gap-4">
              {messages.length > 0 && (
                <div className="flex items-center gap-2">
                  {isConfirmingClear ? (
                    <motion.div 
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg"
                    >
                      <span className="text-[9px] text-red-400 font-bold uppercase tracking-tighter">Confirm?</span>
                      <button 
                        onClick={clearChat}
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[9px] uppercase font-bold transition-colors"
                      >
                        Yes
                      </button>
                      <button 
                        onClick={() => setIsConfirmingClear(false)}
                        className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[9px] uppercase font-bold transition-colors"
                      >
                        No
                      </button>
                    </motion.div>
                  ) : (
                    <button 
                      onClick={() => setIsConfirmingClear(true)}
                      className="flex items-center gap-2 px-3 py-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all text-[10px] uppercase tracking-widest font-medium group"
                      title="Clear Chat History"
                    >
                      <Trash2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                      <span className="hidden sm:inline">Clear History</span>
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => updateSettings({ theme: userSettings.theme === 'dark' ? 'light' : 'dark' })}
                  className={`p-2 rounded-xl transition-all ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'}`}
                  title={userSettings.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {userSettings.theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className={`p-2 rounded-xl transition-all ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'}`}
                  title="Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
                <div className="hidden md:block text-right">
                  <p className={`text-xs font-medium ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{user.displayName}</p>
                  <button onClick={handleLogout} className="text-[10px] text-zinc-500 hover:text-indigo-400 transition-colors uppercase tracking-widest">Sign Out</button>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-zinc-800" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                    <User className="w-4 h-4 text-zinc-400" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button 
              onClick={() => handleLogin('signin')}
              disabled={isLoggingIn}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-lg shadow-indigo-900/20 ${
                isLoggingIn ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent relative">
        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500/50 backdrop-blur-md px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 max-w-md w-[90%]"
            >
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-red-400 rotate-45" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-red-100">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-200 transition-colors text-xs font-bold uppercase tracking-widest"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Background Grid Pattern */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
             style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #4f46e5 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        
        {!user ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-8 max-w-2xl mx-auto relative z-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-24 h-24 rounded-[2.5rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 shadow-2xl shadow-indigo-500/20 relative"
            >
              <LogIn className="w-12 h-12 text-indigo-400 relative z-10" />
            </motion.div>
            <div className="space-y-4">
              <h2 className="text-4xl font-serif italic font-bold text-white tracking-tight">Sign in to start learning.</h2>
              <p className="text-zinc-500 text-xl font-light leading-relaxed max-w-lg mx-auto">
                Connect your account to save your study sessions and access personalized tutoring.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
                <button 
                  onClick={() => handleLogin('signin')}
                  className="w-full sm:w-auto px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-lg font-semibold transition-all shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-3"
                >
                  <LogIn className="w-6 h-6" />
                  Sign In
                </button>
                <button 
                  onClick={() => handleLogin('signup')}
                  className="w-full sm:w-auto px-8 py-4 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white rounded-2xl text-lg font-semibold transition-all shadow-xl flex items-center justify-center gap-3"
                >
                  <User className="w-6 h-6" />
                  Create Account
                </button>
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="max-w-5xl mx-auto w-full space-y-8 py-4 px-2">
            {/* Welcome & Quote */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2">
                <motion.h2 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-4xl font-serif italic font-bold text-white tracking-tight"
                >
                  Welcome back, {userSettings.displayName.split(' ')[0]}.
                </motion.h2>
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-zinc-500 text-lg font-light italic"
                >
                  "{MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]}"
                </motion.p>
              </div>
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-3 bg-zinc-900/50 border border-zinc-800/50 p-3 rounded-2xl"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-12 h-12 rounded-xl border border-zinc-800" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                    <User className="w-6 h-6 text-zinc-400" />
                  </div>
                )}
                <div>
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Current Level</p>
                  <p className="text-lg font-serif italic text-white">Level {userSettings.stats.level}</p>
                  <div className="mt-1 h-1 w-24 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(userSettings.stats.xp % 100)}%` }} />
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Streak */}
              <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800/50 hover:bg-zinc-900/60' : 'bg-white border-zinc-200 hover:bg-zinc-50'} border p-5 rounded-3xl space-y-3 transition-colors group shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-orange-500" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">Current Streak</span>
                </div>
                <div>
                  <p className={`text-3xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.streak} Days</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Keep it up!</p>
                </div>
              </div>

              {/* Today's Goal */}
              <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800/50 hover:bg-zinc-900/60' : 'bg-white border-zinc-200 hover:bg-zinc-50'} border p-5 rounded-3xl space-y-3 transition-colors group shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <Target className="w-5 h-5 text-indigo-500" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">Today's Goal</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <p className={`text-3xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.todayHours.toFixed(1)} / {userSettings.dailyGoal}h</p>
                    <span className="text-[10px] text-indigo-500 font-bold">
                      {Math.min(100, Math.round((userSettings.stats.todayHours / userSettings.dailyGoal) * 100))}%
                    </span>
                  </div>
                  <div className={`h-1.5 w-full ${userSettings.theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'} rounded-full overflow-hidden`}>
                    <div 
                      className="h-full bg-indigo-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, (userSettings.stats.todayHours / userSettings.dailyGoal) * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Hours */}
              <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800/50 hover:bg-zinc-900/60' : 'bg-white border-zinc-200 hover:bg-zinc-50'} border p-5 rounded-3xl space-y-3 transition-colors group shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-emerald-500" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">Weekly Hours</span>
                </div>
                <div>
                  <p className={`text-3xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.weeklyHours}h</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">This week</p>
                </div>
              </div>

              {/* XP Earned */}
              <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800/50 hover:bg-zinc-900/60' : 'bg-white border-zinc-200 hover:bg-zinc-50'} border p-5 rounded-3xl space-y-3 transition-colors group shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-violet-500" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">XP Earned</span>
                </div>
                <div>
                  <p className={`text-3xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.xp}</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Total experience</p>
                </div>
              </div>
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 bg-zinc-900/40 border border-zinc-800/50 p-6 rounded-3xl flex flex-col sm:flex-row items-center gap-8">
                <div className="flex-1 space-y-4 w-full">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Learning Progress</h3>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span className="text-[10px] text-zinc-500 font-medium uppercase">Focus Score: {userSettings.stats.focusScore}%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/30' : 'bg-zinc-100/50 border-zinc-200/50'} p-4 rounded-2xl border`}>
                      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Sessions</p>
                      <p className={`text-2xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.sessionsCompleted}</p>
                    </div>
                    <div className={`${userSettings.theme === 'dark' ? 'bg-zinc-950/50 border-zinc-800/30' : 'bg-zinc-100/50 border-zinc-200/50'} p-4 rounded-2xl border`}>
                      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Top Subject</p>
                      <p className={`text-2xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'} truncate`}>{userSettings.stats.mostStudiedSubject}</p>
                    </div>
                  </div>
                </div>
                <div className={`w-32 h-32 rounded-full border-4 ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'} flex items-center justify-center relative`}>
                  <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent -rotate-45" />
                  <div className="text-center">
                    <p className={`text-2xl font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{userSettings.stats.focusScore}%</p>
                    <p className="text-[8px] text-zinc-500 uppercase font-bold tracking-tighter">Focus</p>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-6 rounded-3xl text-white space-y-4 shadow-xl shadow-indigo-900/20">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Brain className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full">
                    <Clock className="w-3 h-3 text-indigo-100" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Focus Mode</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-serif italic font-bold">Ready to focus?</h3>
                  <p className="text-xs text-indigo-100/80 leading-relaxed">Set your session goals and start focusing with your AI companion.</p>
                </div>

                <button 
                  onClick={() => setIsSessionSetupOpen(true)}
                  className="w-full py-4 bg-white text-indigo-600 rounded-2xl text-sm font-bold hover:bg-indigo-50 transition-all shadow-lg flex items-center justify-center gap-2 group"
                >
                  <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                  Configure Session
                </button>

                <div className="grid grid-cols-3 gap-2">
                  <button 
                    onClick={() => setIsQuizModalOpen(true)}
                    className="py-2.5 bg-black/20 hover:bg-black/30 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/5 flex flex-col items-center justify-center gap-1 transition-all"
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    Quiz
                  </button>
                  <button 
                    onClick={() => setIsSummarizerModalOpen(true)}
                    className="py-2.5 bg-black/20 hover:bg-black/30 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/5 flex flex-col items-center justify-center gap-1 transition-all"
                  >
                    <Brain className="w-3.5 h-3.5" />
                    Summary
                  </button>
                  <button 
                    onClick={() => setIsFilesModalOpen(true)}
                    className="py-2.5 bg-black/20 hover:bg-black/30 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/5 flex flex-col items-center justify-center gap-1 transition-all"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Files
                  </button>
                </div>
              </div>
            </div>

            {/* Subject Mastery */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Subject Mastery</h3>
                <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-tighter">Gamification Active</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {userSettings.subjects.map((subject) => {
                  const stats = userSettings.stats.subjectStats[subject] || { xp: 0, level: 1, badges: [], studyStreak: 0 };
                  const progress = stats.xp % 100;
                  
                  return (
                    <motion.div 
                      key={subject}
                      whileHover={{ y: -4 }}
                      className={`${userSettings.theme === 'dark' ? 'bg-zinc-900/40 border-zinc-800/50' : 'bg-white border-zinc-200 shadow-sm'} border p-5 rounded-3xl space-y-4 relative overflow-hidden group transition-colors`}
                    >
                      <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                        <BookOpen className={`w-12 h-12 ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`} />
                      </div>
                      
                      <div className="flex items-center justify-between relative z-10">
                        <div className="space-y-1">
                          <h4 className={`text-lg font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{subject}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Lv. {stats.level}</span>
                            {stats.studyStreak >= 3 && (
                              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/10 rounded text-[8px] text-orange-400 font-bold uppercase">
                                <Flame className="w-2 h-2" />
                                {stats.studyStreak} Streak
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 relative z-10">
                        <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                          <span>Progress</span>
                          <span>{progress}%</span>
                        </div>
                        <div className={`h-1.5 w-full ${userSettings.theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'} rounded-full overflow-hidden`}>
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 relative z-10">
                        {stats.badges.length > 0 ? (
                          stats.badges.map((badge, i) => (
                            <div key={i} className="px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-[8px] text-yellow-400 font-bold uppercase tracking-widest flex items-center gap-1">
                              <Trophy className="w-2 h-2" />
                              {badge}
                            </div>
                          ))
                        ) : (
                          <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest italic">No badges yet</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Quick Suggestions */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-1">Quick Actions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                {[
                  "Summarize the main points of the French Revolution",
                  "Explain the Krebs cycle step-by-step",
                  "Create a 5-question quiz on linear algebra",
                  "Help me write a thesis statement for my essay"
                ].map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(suggestion)}
                    className={`p-4 text-left text-sm ${userSettings.theme === 'dark' ? 'text-zinc-400 bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-800/50 hover:text-indigo-300' : 'text-zinc-600 bg-white border-zinc-200 hover:bg-zinc-50 hover:text-indigo-600'} border rounded-2xl transition-all duration-200 group flex items-center justify-between shadow-sm`}
                  >
                    <span className="truncate">{suggestion}</span>
                    <Sparkles className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500 flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    message.role === 'user' ? 'bg-indigo-600' : 'bg-zinc-900 border border-zinc-800'
                  }`}>
                    {message.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div className={`flex flex-col space-y-2 max-w-[85%] ${message.role === 'user' ? 'items-end' : ''}`}>
                    <div className={`px-5 py-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      message.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none font-medium' 
                        : 'bg-zinc-900 border border-zinc-800/50 text-zinc-300 rounded-tl-none'
                    }`}>
                      {message.content}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-4"
              >
                <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                </div>
                <div className="px-4 py-3 rounded-2xl bg-zinc-900/30 border border-zinc-800/30 text-zinc-500 text-sm italic">
                  Study Focus is thinking...
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 md:p-8 bg-gradient-to-t from-[#0a0a0a] to-transparent">
        <div className="max-w-3xl mx-auto relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-800 to-zinc-700 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-500"></div>
          <div className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-2xl p-2 pr-3 shadow-2xl">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!user}
              placeholder={user ? "Ask Study Focus anything..." : "Please sign in to chat"}
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-4 resize-none max-h-32 min-h-[44px] placeholder-zinc-600 disabled:cursor-not-allowed"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || !user}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                input.trim() && !isLoading && user
                  ? 'bg-white text-black hover:bg-zinc-200' 
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-[10px] text-center mt-3 text-zinc-600 font-medium uppercase tracking-widest">
            Study Focus uses AI to assist learning. Always double-check facts.
          </p>
        </div>
      </footer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative w-full max-w-md ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-3xl shadow-2xl overflow-hidden transition-colors duration-500`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                <h2 className={`text-lg font-serif italic font-semibold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>
                  {authMode === 'signin' ? 'Sign In' : 'Create Account'}
                </h2>
                <button 
                  onClick={() => setIsAuthModalOpen(false)}
                  className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-lg transition-all`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {authMode === 'signup' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Full Name</label>
                      <input 
                        type="text" 
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="John Doe"
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} border rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all`}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Email Address</label>
                    <input 
                      type="email" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} border rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Password</label>
                    <input 
                      type="password" 
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} border rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all`}
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-semibold transition-all shadow-lg flex items-center justify-center gap-2"
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                    {authMode === 'signin' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className={`w-full border-t ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className={`${userSettings.theme === 'dark' ? 'bg-zinc-900' : 'bg-white'} px-2 text-zinc-500 font-bold tracking-widest`}>Or continue with</span>
                  </div>
                </div>

                <button 
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  className="w-full py-4 bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 text-black rounded-2xl font-semibold transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </button>

                <div className="text-center">
                  <button 
                    onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
                    className="text-sm text-zinc-500 hover:text-indigo-400 transition-colors"
                  >
                    {authMode === 'signin' ? "Don't have an account? Create one" : "Already have an account? Sign in"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quiz Modal */}
      <AnimatePresence>
        {isQuizModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isGeneratingQuiz) setIsQuizModalOpen(false);
              }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-2xl ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors duration-500`}
            >
              <div className={`p-6 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-white/50'} backdrop-blur-md sticky top-0 z-10`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className={`text-xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>AI Quiz Generator</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Master your subjects with AI</p>
                  </div>
                </div>
                {!isGeneratingQuiz && (
                  <button 
                    onClick={() => setIsQuizModalOpen(false)}
                    className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-xl transition-all absolute top-6 right-6`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-zinc-800">
                {!currentQuiz ? (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Select Subject</label>
                      <div className="flex flex-wrap gap-2">
                        {userSettings.subjects.map((subject) => (
                          <button
                            key={subject}
                            onClick={() => setSelectedSubject(subject)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                              selectedSubject === subject 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40' 
                                : userSettings.theme === 'dark' ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                            }`}
                          >
                            {subject}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Difficulty</label>
                      <div className="grid grid-cols-3 gap-3">
                        {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setQuizDifficulty(d)}
                            className={`py-3 rounded-xl text-xs font-bold transition-all border ${
                              quizDifficulty === d 
                                ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400' 
                                : userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Topic or Context</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Photosynthesis, French Revolution..."
                        value={quizTopic}
                        onChange={(e) => setQuizTopic(e.target.value)}
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'} border rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all`}
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Paste Notes (Optional)</label>
                        <span className="text-[10px] text-zinc-600 font-medium italic">Up to 5000 characters</span>
                      </div>
                      <textarea 
                        placeholder="Paste your study notes here for a more personalized quiz..."
                        value={quizNotes}
                        onChange={(e) => setQuizNotes(e.target.value)}
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'} border rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-32 resize-none scrollbar-thin ${userSettings.theme === 'dark' ? 'scrollbar-thumb-zinc-800' : 'scrollbar-thumb-zinc-200'}`}
                      />
                    </div>

                    {studyFiles.length > 0 && (
                      <div className="space-y-4">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Use Uploaded File</label>
                        <div className="grid grid-cols-1 gap-2">
                          {studyFiles.slice(0, 3).map((file) => (
                            <button
                              key={file.id}
                              onClick={() => {
                                setQuizTopic(file.name);
                                setQuizNotes(file.content);
                              }}
                              className={`flex items-center gap-3 p-3 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-xl hover:border-indigo-500/50 transition-all text-left group`}
                            >
                              <FileText className="w-4 h-4 text-zinc-500 group-hover:text-indigo-400" />
                              <span className={`text-xs ${userSettings.theme === 'dark' ? 'text-zinc-400 group-hover:text-zinc-200' : 'text-zinc-600 group-hover:text-zinc-900'} truncate`}>{file.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={generateQuiz}
                      disabled={isGeneratingQuiz || (!quizTopic && !quizNotes)}
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-3"
                    >
                      {isGeneratingQuiz ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating Quiz...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Generate AI Quiz
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-8 pb-8">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className={`text-lg font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{currentQuiz.topic}</h3>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{currentQuiz.subject} • {currentQuiz.difficulty}</p>
                      </div>
                      {isQuizFinished && (
                        <div className="text-right">
                          <p className="text-2xl font-serif italic text-indigo-400">{quizScore}%</p>
                          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Final Score</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-12">
                      {currentQuiz.questions.map((q, qIndex) => (
                        <div key={qIndex} className="space-y-6">
                          <div className="flex gap-4">
                            <span className={`w-8 h-8 rounded-lg ${userSettings.theme === 'dark' ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-600'} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                              {qIndex + 1}
                            </span>
                            <p className={`text-lg ${userSettings.theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'} leading-relaxed`}>{q.question}</p>
                          </div>

                          <div className="grid grid-cols-1 gap-3 ml-12">
                            {q.options.map((option, oIndex) => {
                              const isSelected = quizAnswers[qIndex] === oIndex;
                              const isCorrect = oIndex === q.correctAnswer;
                              const showResult = isQuizFinished;
                              
                              let buttonClass = userSettings.theme === 'dark' ? "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700" : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300";
                              if (isSelected && !showResult) buttonClass = "bg-indigo-600/10 border-indigo-500 text-indigo-400";
                              if (showResult) {
                                if (isCorrect) buttonClass = "bg-emerald-500/10 border-emerald-500 text-emerald-500";
                                else if (isSelected) buttonClass = "bg-red-500/10 border-red-500 text-red-500";
                                else buttonClass = userSettings.theme === 'dark' ? "bg-zinc-950 border-zinc-800 text-zinc-600 opacity-50" : "bg-zinc-50 border-zinc-200 text-zinc-400 opacity-50";
                              }

                              return (
                                <button
                                  key={oIndex}
                                  disabled={isQuizFinished}
                                  onClick={() => {
                                    const newAnswers = [...quizAnswers];
                                    newAnswers[qIndex] = oIndex;
                                    setQuizAnswers(newAnswers);
                                  }}
                                  className={`p-4 text-left text-sm rounded-2xl border transition-all flex items-center justify-between group ${buttonClass}`}
                                >
                                  <span>{option}</span>
                                  {showResult && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                                  {showResult && isSelected && !isCorrect && <X className="w-4 h-4 text-red-500" />}
                                </button>
                              );
                            })}
                          </div>

                          {isQuizFinished && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`ml-12 p-4 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-2xl space-y-2`}
                            >
                              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Explanation</p>
                              <p className={`text-sm ${userSettings.theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'} leading-relaxed italic`}>{q.explanation}</p>
                            </motion.div>
                          )}
                        </div>
                      ))}
                    </div>

                    {!isQuizFinished ? (
                      <button 
                        onClick={submitQuiz}
                        disabled={quizAnswers.includes(-1)}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-3"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Submit Quiz
                      </button>
                    ) : (
                      <div className="flex gap-4">
                        <button 
                          onClick={() => {
                            setCurrentQuiz(null);
                            setQuizAnswers([]);
                            setIsQuizFinished(false);
                          }}
                          className={`flex-1 py-4 ${userSettings.theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'} rounded-2xl font-bold transition-all flex items-center justify-center gap-3`}
                        >
                          <RotateCcw className="w-5 h-5" />
                          New Quiz
                        </button>
                        <button 
                          onClick={() => setIsQuizModalOpen(false)}
                          className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Study Files Modal */}
      <AnimatePresence>
        {isFilesModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFilesModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-lg ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh] transition-colors duration-500`}
            >
              <div className={`p-6 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-white/50'} backdrop-blur-md sticky top-0 z-10`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600/20 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className={`text-xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>Study Material</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Your personal library</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsFilesModalOpen(false)}
                  className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-xl transition-all`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800">
                <div className="space-y-4">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Upload New File</label>
                  <div className="relative">
                    <input 
                      type="file" 
                      accept=".txt,.md,.pdf"
                      onChange={handleFileUpload}
                      className="hidden" 
                      id="file-upload"
                      disabled={isUploading}
                    />
                    <label 
                      htmlFor="file-upload"
                      className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed ${userSettings.theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-900/50' : 'border-zinc-200 hover:bg-zinc-50'} rounded-2xl cursor-pointer hover:border-indigo-500/50 transition-all ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isUploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                          <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Uploading...</span>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-zinc-600 mb-2" />
                          <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Click to upload text/pdf</span>
                          <span className="text-[10px] text-zinc-700 mt-1">Max 500KB</span>
                        </>
                      )}
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Files</label>
                    <span className="text-[10px] text-zinc-600 font-medium">{studyFiles.length} items</span>
                  </div>
                  <div className="space-y-2">
                    {studyFiles.length > 0 ? (
                      studyFiles.map((file) => (
                        <div key={file.id} className={`flex items-center justify-between p-4 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300'} border rounded-2xl group transition-all`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl ${userSettings.theme === 'dark' ? 'bg-zinc-900' : 'bg-white shadow-sm'} flex items-center justify-center flex-shrink-0`}>
                              <FileText className="w-5 h-5 text-zinc-500" />
                            </div>
                            <div className="min-w-0">
                              <p className={`text-sm ${userSettings.theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'} font-medium truncate`}>{file.name}</p>
                              <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{new Date(file.uploadedAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => {
                                setQuizTopic(file.name);
                                setQuizNotes(file.content);
                                setIsFilesModalOpen(false);
                                setIsQuizModalOpen(true);
                              }}
                              className="p-2 text-zinc-600 hover:text-indigo-400 transition-colors"
                              title="Generate Quiz from this file"
                            >
                              <GraduationCap className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => {
                                setSummaryTopic(file.name);
                                setSummaryNotes(file.content);
                                setIsFilesModalOpen(false);
                                setIsSummarizerModalOpen(true);
                              }}
                              className="p-2 text-zinc-600 hover:text-indigo-400 transition-colors"
                              title="Summarize this file"
                            >
                              <Brain className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={async () => {
                                await deleteDoc(doc(db, 'studyFiles', file.id));
                                toast.success("File deleted");
                              }}
                              className="p-2 text-zinc-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 space-y-3">
                        <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mx-auto">
                          <FileText className="w-6 h-6 text-zinc-800" />
                        </div>
                        <p className="text-sm text-zinc-600 italic">No files uploaded yet.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Summarizer Modal */}
      <AnimatePresence>
        {isSummarizerModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isGeneratingSummary) setIsSummarizerModalOpen(false);
              }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-2xl ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors duration-500`}
            >
              <div className={`p-6 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-white/50'} backdrop-blur-md sticky top-0 z-10`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className={`text-xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>AI Notes Summarizer</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Condense your study material</p>
                  </div>
                </div>
                {!isGeneratingSummary && (
                  <button 
                    onClick={() => setIsSummarizerModalOpen(false)}
                    className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-xl transition-all`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-zinc-800">
                {!summaryResult ? (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Summary Type</label>
                      <div className="grid grid-cols-3 gap-3">
                        {(['Bullet Points', 'Key Concepts', 'Flashcards'] as const).map((type) => (
                          <button
                            key={type}
                            onClick={() => setSummaryType(type)}
                            className={`py-3 rounded-xl text-xs font-bold transition-all border ${
                              summaryType === type 
                                ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400' 
                                : userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300'
                            }`}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Topic (Optional)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Quantum Physics, Marketing Strategy..."
                        value={summaryTopic}
                        onChange={(e) => setSummaryTopic(e.target.value)}
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'} border rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all`}
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Paste Notes</label>
                        <span className="text-[10px] text-zinc-600 font-medium italic">Up to 10,000 characters</span>
                      </div>
                      <textarea 
                        placeholder="Paste your long notes here to be summarized..."
                        value={summaryNotes}
                        onChange={(e) => setSummaryNotes(e.target.value)}
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'} border rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-64 resize-none scrollbar-thin ${userSettings.theme === 'dark' ? 'scrollbar-thumb-zinc-800' : 'scrollbar-thumb-zinc-200'}`}
                      />
                    </div>

                    {studyFiles.length > 0 && (
                      <div className="space-y-4">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Use Uploaded File</label>
                        <div className="grid grid-cols-1 gap-2">
                          {studyFiles.slice(0, 3).map((file) => (
                            <button
                              key={file.id}
                              onClick={() => {
                                setSummaryTopic(file.name);
                                setSummaryNotes(file.content);
                              }}
                              className={`flex items-center gap-3 p-3 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-xl hover:border-indigo-500/50 transition-all text-left group`}
                            >
                              <FileText className="w-4 h-4 text-zinc-500 group-hover:text-indigo-400" />
                              <span className={`text-xs ${userSettings.theme === 'dark' ? 'text-zinc-400 group-hover:text-zinc-200' : 'text-zinc-600 group-hover:text-zinc-900'} truncate`}>{file.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={summarizeNotes}
                      disabled={isGeneratingSummary || (!summaryTopic && !summaryNotes)}
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-3"
                    >
                      {isGeneratingSummary ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Summarizing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Summarize Notes
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6 pb-8">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className={`text-lg font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{summaryTopic || 'Summary'}</h3>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{summaryType}</p>
                      </div>
                      <button 
                        onClick={() => {
                          setSummaryResult('');
                          setSummaryNotes('');
                          setSummaryTopic('');
                        }}
                        className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-xl transition-all`}
                        title="Start Over"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                    </div>

                    <div className={`p-6 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-3xl prose prose-invert max-w-none`}>
                      <div className={`markdown-body ${userSettings.theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} text-sm leading-relaxed`}>
                        <Markdown>{summaryResult}</Markdown>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          const blob = new Blob([summaryResult], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${summaryTopic || 'Summary'}.txt`;
                          a.click();
                        }}
                        className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3"
                      >
                        <Upload className="w-5 h-5" />
                        Download TXT
                      </button>
                      <button 
                        onClick={() => setIsSummarizerModalOpen(false)}
                        className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Session Setup Modal */}
      <AnimatePresence>
        {isSessionSetupOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSessionSetupOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-xl ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors duration-500`}
            >
              <div className={`p-6 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-white/50'} backdrop-blur-md sticky top-0 z-10`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 flex items-center justify-center">
                    <Target className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className={`text-xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>Session Setup</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Define your focus goal</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSessionSetupOpen(false)}
                  className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-xl transition-all`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-zinc-800">
                {/* Timer Modes */}
                <div className="space-y-4">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Timer Mode</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['Pomodoro', 'Deep Study', 'Custom'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setTimerMode(mode);
                          if (mode === 'Pomodoro') setSessionDuration(25);
                          else if (mode === 'Deep Study') setSessionDuration(50);
                        }}
                        className={`py-4 rounded-2xl text-xs font-bold transition-all border flex flex-col items-center gap-2 ${
                          timerMode === mode 
                            ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400 shadow-lg shadow-indigo-900/20' 
                            : userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}
                      >
                        {mode === 'Pomodoro' && <Clock className="w-4 h-4" />}
                        {mode === 'Deep Study' && <Target className="w-4 h-4" />}
                        {mode === 'Custom' && <Settings className="w-4 h-4" />}
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Duration Slider (only for Custom) */}
                {timerMode === 'Custom' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Duration</label>
                      <span className={`text-lg font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{sessionDuration}m</span>
                    </div>
                    <input 
                      type="range" 
                      min="5" 
                      max="180" 
                      step="5"
                      value={sessionDuration}
                      onChange={(e) => setSessionDuration(parseInt(e.target.value))}
                      className={`w-full accent-indigo-500 h-1.5 ${userSettings.theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'} rounded-full appearance-none cursor-pointer`}
                    />
                  </div>
                )}

                {/* Subject Selection */}
                <div className="space-y-4">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Subject</label>
                  <div className="flex flex-wrap gap-2">
                    {userSettings.subjects.map((subject) => (
                      <button
                        key={subject}
                        onClick={() => setSelectedSubject(subject)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                          selectedSubject === subject 
                            ? userSettings.theme === 'dark' ? 'bg-white text-indigo-600 border-white shadow-lg' : 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-900/20'
                            : userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}
                      >
                        {subject}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Topic & Goal */}
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">What are you studying?</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Linear Algebra, User Research..."
                      value={sessionTopic}
                      onChange={(e) => setSessionTopic(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-zinc-700"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Session Goal</label>
                    <textarea 
                      placeholder="e.g. Complete 3 practice problems, Read chapter 4..."
                      value={sessionGoal}
                      onChange={(e) => setSessionGoal(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-24 resize-none placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <button 
                  onClick={startTimer}
                  disabled={!sessionTopic || !sessionGoal}
                  className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-3"
                >
                  <Sparkles className="w-5 h-5" />
                  Start Focus Session
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full Screen Timer Overlay */}
      <AnimatePresence>
        {isTimerActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-zinc-950 flex flex-col items-center justify-center p-8"
          >
            {/* Background Atmosphere */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 blur-[120px] rounded-full animate-pulse" />
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 blur-[120px] rounded-full animate-pulse delay-700" />
            </div>

            <div className="relative z-10 w-full max-w-2xl flex flex-col items-center text-center space-y-12">
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-indigo-400 uppercase tracking-[0.3em]">
                  {isBreak ? <Sparkles className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                  {isBreak ? 'Break Time' : 'Focus Mode Active'}
                </div>
                <h2 className="text-4xl font-serif italic font-bold text-white">
                  {isBreak ? 'Time to Recharge' : sessionTopic}
                </h2>
                {!isBreak && <p className="text-zinc-500 text-sm">{sessionGoal}</p>}
              </div>

              {/* Progress Ring & Timer */}
              <div className="relative w-80 h-80 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90">
                  <circle
                    cx="160"
                    cy="160"
                    r="150"
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-zinc-900"
                  />
                  <motion.circle
                    cx="160"
                    cy="160"
                    r="150"
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeDasharray={2 * Math.PI * 150}
                    initial={{ strokeDashoffset: 2 * Math.PI * 150 }}
                    animate={{ 
                      strokeDashoffset: 2 * Math.PI * 150 * (1 - timeLeft / (isBreak ? (timerMode === 'Pomodoro' ? 5 * 60 : 10 * 60) : sessionDuration * 60)) 
                    }}
                    transition={{ duration: 1, ease: "linear" }}
                    className="text-indigo-500"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2">
                  <span className="text-7xl font-mono font-light tracking-tighter text-white">
                    {formatTime(timeLeft)}
                  </span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    {timerMode} Mode
                  </span>
                </div>
              </div>

              {/* Motivational Message */}
              <motion.p 
                key={motivationalMessage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl font-serif italic text-indigo-100/60 max-w-md"
              >
                "{motivationalMessage}"
              </motion.p>

              {/* Controls */}
              <div className="flex items-center gap-6">
                <button 
                  onClick={() => handleExitAttempt('quit')}
                  className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:border-red-400/50 transition-all"
                  title="Quit Session"
                >
                  <X className="w-6 h-6" />
                </button>
                <button 
                  onClick={toggleTimer}
                  className="w-24 h-24 rounded-full bg-white text-zinc-950 flex items-center justify-center shadow-2xl shadow-white/10 hover:scale-105 transition-all"
                >
                  {isTimerRunning ? (
                    <div className="flex gap-1.5">
                      <div className="w-2 h-8 bg-current rounded-full" />
                      <div className="w-2 h-8 bg-current rounded-full" />
                    </div>
                  ) : (
                    <div className="w-0 h-0 border-t-[15px] border-t-transparent border-l-[25px] border-l-current border-b-[15px] border-b-transparent ml-2" />
                  )}
                </button>
                <button 
                  onClick={() => handleExitAttempt('finish')}
                  className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-emerald-400 hover:border-emerald-400/50 transition-all"
                  title="Finish Early"
                >
                  <CheckCircle2 className="w-6 h-6" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart Exit Check Modal */}
      <AnimatePresence>
        {isSmartExitModalOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-lg ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-[2.5rem] shadow-2xl overflow-hidden transition-colors duration-500`}
            >
              <div className="p-8 space-y-8">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-3xl bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
                    <Brain className="w-8 h-8 text-amber-500" />
                  </div>
                  <h2 className={`text-2xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>Wait! Before you go...</h2>
                  <p className="text-zinc-500 text-sm">Let's do a quick check-in on what you've learned so far.</p>
                </div>

                {isGeneratingExitQuiz ? (
                  <div className="py-12 flex flex-col items-center justify-center space-y-4">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest animate-pulse">Generating quick check...</p>
                  </div>
                ) : isExitQuizCompleted ? (
                  <div className="space-y-6 py-4">
                    <div className="text-center space-y-4">
                      <div className={`text-5xl font-serif italic font-bold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>
                        {exitQuizScore}/3
                      </div>
                      <p className="text-zinc-400 text-sm">
                        {exitQuizScore === 3 
                          ? "Perfect! You've really mastered this topic." 
                          : exitQuizScore >= 1 
                            ? "Good effort! You're making progress." 
                            : "Keep at it! Learning takes time."}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={() => {
                          setIsSmartExitModalOpen(false);
                          if (exitReason === 'finish') {
                            setTimeLeft(0);
                          } else {
                            resetTimer();
                          }
                        }}
                        className={`w-full py-4 ${userSettings.theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'} rounded-2xl font-bold transition-all`}
                      >
                        {exitReason === 'finish' ? 'Finish Session' : 'Exit Session'}
                      </button>
                      <button 
                        onClick={() => {
                          setIsSmartExitModalOpen(false);
                          setIsTimerRunning(true);
                        }}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40"
                      >
                        Continue Studying
                      </button>
                    </div>
                  </div>
                ) : exitQuizQuestions.length > 0 ? (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Question {currentExitQuizIndex + 1} of 3</span>
                        <div className="flex gap-1">
                          {[0, 1, 2].map((i) => (
                            <div 
                              key={i} 
                              className={`w-8 h-1 rounded-full transition-all ${i <= currentExitQuizIndex ? 'bg-indigo-500' : 'bg-zinc-800'}`} 
                            />
                          ))}
                        </div>
                      </div>
                      <h3 className={`text-lg font-medium ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'} leading-snug`}>
                        {exitQuizQuestions[currentExitQuizIndex].question}
                      </h3>
                    </div>

                    <div className="grid gap-3">
                      {exitQuizQuestions[currentExitQuizIndex].options.map((option, index) => {
                        const isSelected = selectedExitOption === index;
                        const isCorrect = index === exitQuizQuestions[currentExitQuizIndex].correctAnswer;
                        
                        let buttonClass = userSettings.theme === 'dark' ? "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700" : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-zinc-300";
                        if (showExitExplanation) {
                          if (isCorrect) buttonClass = "bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-lg shadow-emerald-900/20";
                          else if (isSelected) buttonClass = "bg-red-500/10 border-red-500 text-red-500 shadow-lg shadow-red-900/20";
                        }

                        return (
                          <button
                            key={index}
                            onClick={() => handleExitQuizAnswer(index)}
                            disabled={showExitExplanation}
                            className={`w-full p-4 rounded-2xl text-left text-sm font-medium transition-all border ${buttonClass}`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold border ${
                                isSelected ? 'bg-current text-zinc-950' : 'border-zinc-800'
                              }`}>
                                {String.fromCharCode(65 + index)}
                              </span>
                              {option}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {showExitExplanation && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl space-y-2"
                      >
                        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Explanation</p>
                        <p className="text-xs text-indigo-100/60 leading-relaxed">
                          {exitQuizQuestions[currentExitQuizIndex].explanation}
                        </p>
                        <button 
                          onClick={nextExitQuestion}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all mt-2"
                        >
                          {currentExitQuizIndex === 2 ? "Finish Check" : "Next Question"}
                        </button>
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center space-y-6">
                    <p className="text-zinc-500 text-sm text-center">We couldn't generate a quiz right now. Would you like to continue or {exitReason === 'finish' ? 'finish' : 'exit'}?</p>
                    <div className="flex flex-col w-full gap-3">
                      <button 
                        onClick={() => {
                          setIsSmartExitModalOpen(false);
                          if (exitReason === 'finish') {
                            setTimeLeft(0);
                          } else {
                            resetTimer();
                          }
                        }}
                        className={`w-full py-4 ${userSettings.theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'} rounded-2xl font-bold transition-all`}
                      >
                        {exitReason === 'finish' ? 'Finish Anyway' : 'Exit Anyway'}
                      </button>
                      <button 
                        onClick={() => {
                          setIsSmartExitModalOpen(false);
                          setIsTimerRunning(true);
                        }}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-indigo-900/40"
                      >
                        Continue Studying
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative w-full max-w-lg ${userSettings.theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'} border rounded-3xl shadow-2xl overflow-hidden transition-colors duration-500`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                    <Settings className="w-4 h-4 text-indigo-400" />
                  </div>
                  <h2 className={`text-lg font-serif italic font-semibold ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>Settings</h2>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className={`p-2 ${userSettings.theme === 'dark' ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'} rounded-lg transition-all`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={`p-6 space-y-8 max-h-[70vh] overflow-y-auto scrollbar-thin ${userSettings.theme === 'dark' ? 'scrollbar-thumb-zinc-800' : 'scrollbar-thumb-zinc-200'}`}>
                {/* Profile Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                    <User className="w-3 h-3" />
                    Profile
                  </div>
                  <div className="space-y-2">
                    <label className={`text-sm ${userSettings.theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>Display Name</label>
                    <input 
                      type="text" 
                      value={userSettings.displayName}
                      onChange={(e) => updateSettings({ displayName: e.target.value })}
                      className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} border rounded-xl px-4 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all`}
                    />
                  </div>
                </section>
                
                {/* Appearance Section */}
                <section className={`space-y-4 pt-4 border-t ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                        {userSettings.theme === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                        Appearance
                      </div>
                      <p className={`text-[10px] ${userSettings.theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>Switch between light and dark themes.</p>
                    </div>
                    <div className={`flex items-center ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-100 border-zinc-200'} border rounded-xl p-1`}>
                      <button 
                        onClick={() => updateSettings({ theme: 'light' })}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 ${
                          userSettings.theme === 'light' 
                            ? 'bg-white text-zinc-950 shadow-lg' 
                            : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        <Sun className="w-3 h-3" />
                        Light
                      </button>
                      <button 
                        onClick={() => updateSettings({ theme: 'dark' })}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 ${
                          userSettings.theme === 'dark' 
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <Moon className="w-3 h-3" />
                        Dark
                      </button>
                    </div>
                  </div>
                </section>

                {/* Study Preferences */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                    <Brain className="w-3 h-3" />
                    Study Method
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {['Pomodoro', 'Active Recall', 'Spaced Repetition', 'Feynman Technique'].map((method) => (
                      <button
                        key={method}
                        onClick={() => updateSettings({ studyMethod: method })}
                        className={`p-3 text-left text-xs rounded-xl border transition-all ${
                          userSettings.studyMethod === method 
                            ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400' 
                            : userSettings.theme === 'dark' 
                              ? 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Goals */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                    <Target className="w-3 h-3" />
                    Daily Goal (Hours)
                  </div>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="1" 
                      max="12" 
                      value={userSettings.dailyGoal}
                      onChange={(e) => updateSettings({ dailyGoal: parseInt(e.target.value) })}
                      className="flex-1 accent-indigo-500"
                    />
                    <span className={`text-lg font-serif italic ${userSettings.theme === 'dark' ? 'text-white' : 'text-zinc-900'} w-8 text-center`}>{userSettings.dailyGoal}</span>
                  </div>
                </section>

                {/* Subjects Section */}
                <section className={`space-y-4 pt-4 border-t ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                      <BookOpen className="w-3 h-3" />
                      Subjects
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text"
                        placeholder="Add subject..."
                        className={`border ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-500 w-24`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const value = (e.target as HTMLInputElement).value.trim();
                            if (value && !userSettings.subjects.includes(value)) {
                              updateSettings({ subjects: [...userSettings.subjects, value] });
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {userSettings.subjects.map((subject) => (
                      <div key={subject} className={`flex items-center gap-2 px-3 py-1.5 border ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} rounded-xl group`}>
                        <span className={`text-xs ${userSettings.theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>{subject}</span>
                        <button 
                          onClick={() => {
                            if (userSettings.subjects.length > 1) {
                              updateSettings({ subjects: userSettings.subjects.filter(s => s !== subject) });
                            } else {
                              toast.error("You must have at least one subject.");
                            }
                          }}
                          className="text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Notifications */}
                <section className={`space-y-4 pt-4 border-t ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                        <Bell className="w-3 h-3" />
                        Notifications
                      </div>
                      <p className="text-[10px] text-zinc-600">Reminders for streaks, goals, and study times.</p>
                    </div>
                    <button 
                      onClick={() => updateSettings({ notificationsEnabled: !userSettings.notificationsEnabled })}
                      className={`w-10 h-5 rounded-full transition-all relative ${
                        userSettings.notificationsEnabled ? 'bg-indigo-600' : userSettings.theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'
                      }`}
                    >
                      <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                        userSettings.notificationsEnabled ? 'left-6' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  
                  {userSettings.notificationsEnabled && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-3 pt-2"
                    >
                      <label className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Daily Reminder Time</label>
                      <input 
                        type="time" 
                        value={userSettings.reminderTime}
                        onChange={(e) => updateSettings({ reminderTime: e.target.value })}
                        className={`w-full ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-zinc-50 border-zinc-200 text-zinc-900'} border rounded-xl px-4 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all`}
                      />
                    </motion.div>
                  )}
                </section>

                {/* Focus Protocol */}
                <section className={`space-y-6 pt-4 border-t ${userSettings.theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                      <Shield className="w-3 h-3" />
                      Focus Protocol
                    </div>
                    <p className={`text-[10px] ${userSettings.theme === 'dark' ? 'text-zinc-600' : 'text-zinc-400'}`}>Define your digital environment during study sessions.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Blocked Apps/Sites</label>
                      <div className="flex flex-wrap gap-2">
                        {userSettings.blockedApps.map((app, i) => (
                          <span key={i} className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400">
                            {app}
                            <button onClick={() => {
                              const newList = userSettings.blockedApps.filter((_, index) => index !== i);
                              updateSettings({ blockedApps: newList });
                            }} className="hover:text-red-200 transition-colors">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <button 
                          onClick={() => {
                            const app = prompt("Enter app or site name to block:");
                            if (app) updateSettings({ blockedApps: [...userSettings.blockedApps, app] });
                          }}
                          className={`px-2 py-1 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-lg text-[10px] text-zinc-500 hover:border-zinc-700 transition-all`}
                        >
                          + Add
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Allowed Tools</label>
                      <div className="flex flex-wrap gap-2">
                        {userSettings.allowedTools.map((tool, i) => (
                          <span key={i} className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[10px] text-emerald-400">
                            {tool}
                            <button onClick={() => {
                              const newList = userSettings.allowedTools.filter((_, index) => index !== i);
                              updateSettings({ allowedTools: newList });
                            }} className="hover:text-emerald-200 transition-colors">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <button 
                          onClick={() => {
                            const tool = prompt("Enter tool name to allow:");
                            if (tool) updateSettings({ allowedTools: [...userSettings.allowedTools, tool] });
                          }}
                          className={`px-2 py-1 ${userSettings.theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border rounded-lg text-[10px] text-zinc-500 hover:border-zinc-700 transition-all`}
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="p-6 bg-zinc-950/50 border-t border-zinc-800">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-semibold transition-all"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
