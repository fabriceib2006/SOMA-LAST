/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { initAuth } from './lib/auth';
import { Home, Calendar, Library, BarChart2, MessageSquare, BookOpen, Key } from 'lucide-react';
import { auth } from './lib/firebase';
import Login from './components/Login';
import { HomeDashboard } from './components/HomeDashboard';
import { LibraryHome } from './components/library/LibraryHome';
import { StudyPlanner } from './components/StudyPlanner';
import { AcademicDashboard } from './components/AcademicDashboard';
import { SemesterDashboard } from './components/SemesterDashboard';
import { AITutorDashboard } from './components/AITutorDashboard';
import { PracticeSession } from './components/PracticeSession';
import { getModules, getTopics } from './lib/db';
import { Module, Topic } from './types';

import { SOMAProvider, useSOMA } from './lib/realtime';
import { InstallPwaBanner } from './components/InstallPwaBanner';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ApiKeySettingsModal } from './components/common/ApiKeySettingsModal';

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="SOMA Academic Application Recovery">
      <SOMAProvider>
        <AppContent />
      </SOMAProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState('Home');
  const [tutorTarget, setTutorTarget] = useState<{ 
    topic?: string; 
    module?: string; 
    prompt?: string;
    sessionId?: string;
    reason?: string;
    objective?: string;
    dayId?: string;
    date?: string;
  } | null>(null);
  const [targetDay, setTargetDay] = useState<any>(null);
  const [practiceTarget, setPracticeTarget] = useState<{ moduleId: string; topicId: string } | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  
  const { user, loading } = useSOMA();

  useEffect(() => {
    const handleOpenSettings = (e: any) => {
      if (e?.detail?.error) {
        setApiKeyError(e.detail.error);
      }
      setIsApiKeyModalOpen(true);
    };
    window.addEventListener('soma-open-api-settings', handleOpenSettings);
    return () => window.removeEventListener('soma-open-api-settings', handleOpenSettings);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-neutral-500 italic">Synchronizing SOMA Intelligence...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login />
        <div className="fixed top-4 right-4 z-50">
          <button 
            onClick={() => setIsApiKeyModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur-md shadow-lg rounded-xl text-xs font-semibold text-neutral-700 hover:text-blue-600 border border-neutral-200 transition-all"
          >
            <Key className="w-4 h-4 text-blue-600" /> SOMA Settings
          </button>
        </div>
        <ApiKeySettingsModal 
          isOpen={isApiKeyModalOpen} 
          onClose={() => setIsApiKeyModalOpen(false)} 
          initialError={apiKeyError}
        />
      </>
    );
  }

  const renderContent = () => {
    if (practiceTarget) {
      return (
        <PracticeSession 
          moduleId={practiceTarget.moduleId}
          topicId={practiceTarget.topicId}
          onClose={() => setPracticeTarget(null)}
          onOpenAI={(target) => {
            setTutorTarget(target);
            setPracticeTarget(null);
            setActiveTab('AI');
          }}
        />
      );
    }

    switch (activeTab) {
      case 'Home':
        return (
          <HomeDashboard 
            user={user} 
            onNavigateTab={tab => setActiveTab(tab)} 
            onOpenDay={day => {
              setTargetDay(day);
              setActiveTab('Semester');
            }} 
            onOpenAI={(target) => {
              if (target) setTutorTarget(target);
              setActiveTab('AI');
            }} 
            onOpenPractice={(moduleId, topicId) => setPracticeTarget({ moduleId, topicId })}
          />
        );
      case 'Semester':
        return (
          <StudyPlanner 
            onOpenAI={(target) => {
              if (target) setTutorTarget(target);
              setActiveTab('AI');
            }}
            onOpenPractice={(moduleId, topicId) => {
              setPracticeTarget({ moduleId, topicId });
              setActiveTab('Practice');
            }}
          />
        );
      case 'Library':
        return <LibraryHome />;
      case 'Progress':
        return (
          <AcademicDashboard 
            onNavigateTab={tab => setActiveTab(tab)} 
            onOpenTopicInTutor={(topic, module) => {
              setTutorTarget({
                topic,
                module,
                prompt: `Let's work on ${topic} in ${module}. Please test my understanding with an active recall question.`
              });
              setActiveTab('AI');
            }}
            onOpenPractice={(moduleId, topicId) => setPracticeTarget({ moduleId, topicId })}
          />
        );
      case 'AI':
        return (
          <AITutorDashboard 
            user={user}
            initialTarget={tutorTarget}
            onClearTarget={() => setTutorTarget(null)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <InstallPwaBanner />
      <div className="px-6 pt-8 pb-20 max-w-5xl mx-auto">
        {renderContent()}
      </div>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-2 flex justify-around items-center z-10 shadow-lg">
        {['Home', 'Semester', 'Library', 'Progress', 'AI'].map(tab => {
          const iconMap: Record<string, any> = {
            Semester: BookOpen,
            Home,
            Library,
            Progress: BarChart2,
            AI: MessageSquare
          };
          const Icon = iconMap[tab];
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex flex-col items-center p-2 rounded-xl transition-colors ${activeTab === tab ? 'text-blue-600 font-semibold' : 'text-neutral-400 hover:text-neutral-600'}`}>
              <Icon size={22} />
              <span className="text-[10px] mt-1">{tab}</span>
            </button>
          );
        })}
        <button 
          onClick={() => setIsApiKeyModalOpen(true)}
          className="flex flex-col items-center p-2 rounded-xl text-neutral-400 hover:text-blue-600 transition-colors"
          title="SOMA Settings & API Key"
        >
          <Key size={22} />
          <span className="text-[10px] mt-1">Settings</span>
        </button>
      </nav>

      <ApiKeySettingsModal 
        isOpen={isApiKeyModalOpen} 
        onClose={() => setIsApiKeyModalOpen(false)} 
        initialError={apiKeyError}
      />
    </div>
  );
}
