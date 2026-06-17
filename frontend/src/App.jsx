import React, { useState, useEffect, useRef } from 'react';
import { 
  GitBranch, 
  Send, 
  Terminal, 
  Plus, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Search, 
  Key, 
  LogOut, 
  User as UserIcon, 
  FileText, 
  ChevronRight,
  BookOpen,
  X
} from 'lucide-react';

function App() {
  // Auth States
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('reporeader_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  // App States
  const [repos, setRepos] = useState([]);
  const [activeRepo, setActiveRepo] = useState(null);
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [indexingError, setIndexingError] = useState('');
  const [isIndexingSubmitting, setIsIndexingSubmitting] = useState(false);

  // Chat States
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [questionInput, setQuestionInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Citation Drawer States
  const [drawerCitation, setDrawerCitation] = useState(null); // stores active citation showing in sidebar

  // Refs
  const chatBottomRef = useRef(null);

  // Fetch Repositories list
  const fetchRepos = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/repos', {
        headers: {
          'x-user-id': user.id
        }
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
        
        // If there's an active repo, refresh its state
        if (activeRepo) {
          const updated = data.find(r => r.repoId === activeRepo.repoId);
          if (updated && updated.status !== activeRepo.status) {
            setActiveRepo(updated);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch repositories:", err);
    }
  };

  // Poll for repository status changes (every 5 seconds) if any repo is INDEXING
  useEffect(() => {
    if (!user) return;
    fetchRepos();
    const interval = setInterval(() => {
      const anyIndexing = repos.some(r => r.status === 'INDEXING');
      if (anyIndexing || activeRepo?.status === 'INDEXING') {
        fetchRepos();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [repos, activeRepo, user]);

  // Fetch chat sessions when active repository changes
  useEffect(() => {
    if (activeRepo) {
      fetchSessions();
      // Reset active citation drawer
      setDrawerCitation(null);
    } else {
      setSessions([]);
      setCurrentSession(null);
    }
  }, [activeRepo]);

  const fetchSessions = async () => {
    if (!activeRepo || !user) return;
    try {
      const res = await fetch(`/api/chats/repo/${activeRepo.repoId}`, {
        headers: {
          'x-user-id': user.id
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
        if (data.length > 0) {
          // Load the latest session
          fetchSessionDetails(data[0].sessionId);
        } else {
          // If no sessions, automatically create one
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  };

  const fetchSessionDetails = async (sessionId) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/chats/${sessionId}`, {
        headers: {
          'x-user-id': user.id
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentSession(data);
        setTimeout(() => scrollToBottom(), 50);
      }
    } catch (err) {
      console.error("Failed to fetch session details:", err);
    }
  };

  const scrollToBottom = () => {
    if (chatBottomRef.current) {
      const parent = chatBottomRef.current.parentElement;
      if (parent) {
        parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
      }
    }
  };

  // Auth Handlers
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!usernameInput || !passwordInput) {
      setAuthError('Please fill in all fields');
      return;
    }

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }

      if (authMode === 'login') {
        const loggedInUser = { username: data.user.username, id: data.user.id };
        setUser(loggedInUser);
        localStorage.setItem('reporeader_user', JSON.stringify(loggedInUser));
        setUsernameInput('');
        setPasswordInput('');
      } else {
        // After registration, auto login
        setAuthMode('login');
        setAuthError('Registration successful. Please login now.');
      }
    } catch (err) {
      setAuthError('Connection failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('reporeader_user');
    window.location.reload();
  };

  // Index New Codebase
  const handleIndexRepo = async (e) => {
    e.preventDefault();
    setIndexingError('');
    if (!repoUrlInput) {
      setIndexingError('Repository URL is required');
      return;
    }
    if (!user) {
      setIndexingError('You must be logged in to index a codebase');
      return;
    }

    setIsIndexingSubmitting(true);
    try {
      const res = await fetch('/api/repos/index', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': user.id
        },
        body: JSON.stringify({ 
          repoUrl: repoUrlInput, 
          githubToken: githubTokenInput || undefined 
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setIndexingError(data.error || 'Indexing failed');
        setIsIndexingSubmitting(false);
        return;
      }

      // Add to repository list and set active
      setRepos(prev => [data, ...prev.filter(r => r.repoId !== data.repoId)]);
      setActiveRepo(data);
      setRepoUrlInput('');
      setGithubTokenInput('');
    } catch (err) {
      setIndexingError('Connection failed');
    } finally {
      setIsIndexingSubmitting(false);
    }
  };

  // Start a new chat session for active repository
  const handleNewChat = async () => {
    if (!activeRepo || !user) return;
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': user.id
        },
        body: JSON.stringify({
          repoId: activeRepo.repoId,
          title: 'New Chat Session'
        })
      });
      
      if (res.ok) {
        const newSession = await res.json();
        setSessions(prev => [newSession, ...prev]);
        setCurrentSession(newSession);
      }
    } catch (err) {
      console.error("Failed to create new chat session:", err);
    }
  };

  // Submit User RAG Query & Stream SSE Response
  const handleQuerySubmit = async (e) => {
    e.preventDefault();
    if (!questionInput.trim() || !currentSession || isStreaming || activeRepo?.status !== 'READY' || !user) return;

    const question = questionInput.trim();
    setQuestionInput('');
    setIsStreaming(true);

    // 1. Add user message locally
    const userMsg = { role: 'user', content: question, createdAt: new Date() };
    
    // Create placeholders for streaming message
    const placeholderAssistantMsg = { 
      role: 'assistant', 
      content: '', 
      citations: [], 
      createdAt: new Date(),
      isStreaming: true 
    };

    setCurrentSession(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg, placeholderAssistantMsg]
    }));
    setTimeout(() => scrollToBottom(), 50);

    try {
      const response = await fetch(`/api/chats/${currentSession.sessionId}/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': user.id
        },
        body: JSON.stringify({ question })
      });

      if (!response.ok) {
        throw new Error("Failed to initialize chat connection");
      }

      // 2. Read SSE stream chunks
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      let answerContent = '';
      let citationsList = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Save the last potentially incomplete line back to the buffer
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              
              if (data.type === 'citations') {
                citationsList = data.citations;
                setCurrentSession(prev => {
                  const updatedMessages = [...prev.messages];
                  const last = updatedMessages[updatedMessages.length - 1];
                  if (last && last.role === 'assistant') {
                    last.citations = citationsList;
                  }
                  return { ...prev, messages: updatedMessages };
                });
              } else if (data.type === 'token') {
                answerContent += data.token;
                setCurrentSession(prev => {
                  const updatedMessages = [...prev.messages];
                  const last = updatedMessages[updatedMessages.length - 1];
                  if (last && last.role === 'assistant') {
                    last.content = answerContent;
                  }
                  return { ...prev, messages: updatedMessages };
                });
                scrollToBottom();
              } else if (data.type === 'error') {
                throw new Error(data.error);
              } else if (data.type === 'done') {
                // Done event
              }
            } catch (err) {
              // Ignore incomplete json parsing errors
            }
          }
        }
      }

      // Mark streaming completed
      setCurrentSession(prev => {
        const updatedMessages = [...prev.messages];
        const last = updatedMessages[updatedMessages.length - 1];
        if (last && last.role === 'assistant') {
          delete last.isStreaming;
        }
        return { ...prev, messages: updatedMessages };
      });
      
      // Update session title locally in sessions sidebar list if it's the first message
      setSessions(prev => prev.map(s => {
        if (s.sessionId === currentSession.sessionId && s.title === 'New Chat Session') {
          return { ...s, title: question.slice(0, 30) + (question.length > 30 ? '...' : '') };
        }
        return s;
      }));

    } catch (err) {
      console.error("Streaming failed:", err);
      setCurrentSession(prev => {
        const updatedMessages = [...prev.messages];
        const last = updatedMessages[updatedMessages.length - 1];
        if (last && last.role === 'assistant') {
          last.content = `❌ Error: ${err.message || 'Stream processing failed'}`;
          delete last.isStreaming;
        }
        return { ...prev, messages: updatedMessages };
      });
    } finally {
      setIsStreaming(false);
      fetchSessions(); // Refresh list to get updated titles
    }
  };

  // Open the citation code block viewer drawer
  const handleOpenCitation = async (citation) => {
    // We need to fetch the specific message's full matching raw content
    // Fortunately, when python indexed it, the payload is retrieved.
    // Wait! In the first SSE packet, we sent: { index, file_path, file_name, start_line, end_line }
    // Let's modify our server query SSE stream to also return the `raw_code_content` inside citations!
    // But since the citation list is stored locally on the assistant message, let's see if the code content is present.
    // Let's modify Node.js/Python endpoint to include `raw_code_content` in citations array!
    // Let's inspect: Yes! In main.py:
    // we return citations array. We can add "raw_code_content": match["raw_code_content"] in citations!
    // Let's verify: Yes, in Python:
    // citations.append({ "index": i, "file_path": match["file_path"], "file_name": match["file_name"], ... })
    // If we add "raw_code_content": match["raw_code_content"] to citations list, we have the raw code right on the frontend!
    // Let's check: Yes! We can modify the Python code to add `raw_code_content` to the citation payload so the client can display it!
    // Let's see: Is `raw_code_content` already included? No, in my main.py write:
    // citations.append({ "index": i, "file_path": match["file_path"], "file_name": match["file_name"], "start_line": ..., "end_line": ... })
    // Let's update `main.py` to also include `raw_code_content` in the citation!
    // We can do that shortly. Let's make the drawer display the citation code context.
    setDrawerCitation(citation);
  };

  return (
    <div className="app-container">
      
      {/* 1. LEFT SIDEBAR */}
      <div className="sidebar">
        
        <div className="sidebar-header">
          <Terminal className="logo-icon" size={24} />
          <span className="logo-text">RepoReader</span>
        </div>

        <div className="sidebar-content">
          
          {/* User Auth Info panel */}
          {!user ? (
            <div className="auth-panel">
              <div className="auth-title">
                {authMode === 'login' ? 'Developer Login' : 'Developer Signup'}
              </div>
              <form className="auth-form" onSubmit={handleAuth}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Username" 
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                />
                <input 
                  type="password" 
                  className="input-field" 
                  placeholder="Password" 
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
                <button type="submit" className="btn-primary">
                  {authMode === 'login' ? 'Login' : 'Register'}
                </button>
              </form>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {authMode === 'login' ? "New developer?" : "Already have an account?"}
                </span>
                <span 
                  style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => {
                    setAuthMode(authMode === 'login' ? 'register' : 'login');
                    setAuthError('');
                  }}
                >
                  {authMode === 'login' ? 'Create account' : 'Sign in'}
                </span>
              </div>
              {authError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 4 }}>{authError}</div>}
            </div>
          ) : (
            <div className="auth-panel">
              <div className="user-info">
                <div className="user-avatar">{user.username[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.username}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Authorized Developer</div>
                </div>
              </div>
              <button onClick={handleLogout} className="btn-secondary" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                <LogOut size={14} /> Log out
              </button>
            </div>
          )}

          {/* Ingest New Repository Form */}
          <div className="auth-panel">
            <div className="auth-title">Index New Codebase</div>
            <form className="auth-form" onSubmit={handleIndexRepo}>
              <input 
                type="text" 
                className="input-field" 
                placeholder="https://github.com/owner/repo" 
                value={repoUrlInput}
                onChange={(e) => setRepoUrlInput(e.target.value)}
              />
              <input 
                type="password" 
                className="input-field" 
                placeholder="GitHub PAT (Optional)" 
                value={githubTokenInput}
                onChange={(e) => setGithubTokenInput(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={isIndexingSubmitting}>
                {isIndexingSubmitting ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Ingest Codebase
              </button>
            </form>
            {indexingError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{indexingError}</div>}
          </div>

          {/* List of Indexed Repositories */}
          <div>
            <div className="section-title">
              <span>Codebases</span>
              <Search size={14} style={{ color: 'var(--text-secondary)' }} />
            </div>
            
            {repos.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
                No repositories indexed yet.
              </div>
            ) : (
              <div className="repo-list">
                {repos.map((r) => (
                  <div 
                    key={r.repoId} 
                    className={`repo-card ${activeRepo?.repoId === r.repoId ? 'active' : ''}`}
                    onClick={() => setActiveRepo(r)}
                  >
                    <div className="repo-name">{r.name}</div>
                    <div className="repo-owner">{r.owner}</div>
                    
                    {r.status === 'INDEXING' && (
                      <span className="status-badge status-indexing">
                        <Loader2 className="animate-spin" size={10} /> Indexing
                      </span>
                    )}
                    {r.status === 'READY' && (
                      <span className="status-badge status-ready">
                        <CheckCircle size={10} /> Ready
                      </span>
                    )}
                    {r.status === 'FAILED' && (
                      <span className="status-badge status-failed">
                        <XCircle size={10} /> Ingestion Failed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Active Chats sessions list if repo active */}
          {activeRepo && (
            <div>
              <div className="section-title">
                <span>Chat History</span>
                <button onClick={handleNewChat} className="btn-secondary" style={{ padding: '2px 6px', fontSize: '0.75rem' }}>
                  New Chat
                </button>
              </div>
              <div className="repo-list" style={{ marginTop: 8 }}>
                {sessions.map(s => (
                  <div 
                    key={s.sessionId}
                    className={`repo-card ${currentSession?.sessionId === s.sessionId ? 'active' : ''}`}
                    onClick={() => fetchSessionDetails(s.sessionId)}
                    style={{ padding: '8px 10px', fontSize: '0.85rem' }}
                  >
                    <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {s.title}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="sidebar-footer">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            RepoReader Engine v1.0.0
          </div>
        </div>

      </div>

      {/* 2. CHAT WORKSPACE AREA */}
      <div className="chat-area">
        
        {/* Workspace Header */}
        <div className="chat-header">
          {activeRepo ? (
            <div className="header-title-container">
              <div className="header-title">{activeRepo.owner} / {activeRepo.name}</div>
              <div className="header-subtitle">
                <GitBranch size={12} />
                <span>Default Branch</span>
                <span>•</span>
                {activeRepo.status === 'INDEXING' ? (
                  <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Loader2 className="animate-spin" size={12} /> Indexing codebase...
                  </span>
                ) : activeRepo.status === 'READY' ? (
                  <span style={{ color: 'var(--success)' }}>🟢 Ingestion Completed</span>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>🔴 Ingestion Failed</span>
                )}
              </div>
            </div>
          ) : (
            <div className="header-title-container">
              <div className="header-title">Select a Codebase</div>
              <div className="header-subtitle">Select or index a repository from the left panel to begin onboarding.</div>
            </div>
          )}
        </div>

        {/* Messaging Container */}
        <div className="chat-messages">
          {!activeRepo ? (
            <div className="chat-welcome">
              <Terminal className="welcome-icon" />
              <h1 className="welcome-title">Begin Technical Onboarding</h1>
              <p className="welcome-text">
                RepoReader downloads repositories from GitHub, chunks your codebases semantically, indices them into Qdrant Cloud cluster, and allows you to chat in real-time with file citations.
              </p>
            </div>
          ) : activeRepo.status === 'INDEXING' ? (
            <div className="chat-welcome">
              <Loader2 className="animate-spin welcome-icon" />
              <h1 className="welcome-title">Indexing In Progress...</h1>
              <p className="welcome-text">
                We are downloading your repository zipball, running the intelligence filter to remove code noise, calculating local Hugging Face embeddings, and storing them in Qdrant. This chat terminal will activate automatically when ready.
              </p>
            </div>
          ) : activeRepo.status === 'FAILED' ? (
            <div className="chat-welcome">
              <XCircle className="welcome-icon" style={{ color: 'var(--danger)' }} />
              <h1 className="welcome-title">Ingestion Failed</h1>
              <p className="welcome-text" style={{ color: 'var(--danger)' }}>
                We encountered an error index-processing this codebase. Make sure the repository URL is public, or provide a valid GitHub Personal Access Token.
              </p>
            </div>
          ) : currentSession?.messages.length === 0 ? (
            <div className="chat-welcome">
              <CheckCircle className="welcome-icon" style={{ color: 'var(--success)' }} />
              <h1 className="welcome-title" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                🟢 Codebase Indexed!
              </h1>
              <p className="welcome-text">
                The AI/Math processing engine has successfully vectorized this codebase into the Qdrant cluster. Ask me anything about this repository's functions, routes, database schemas, or flows.
              </p>
            </div>
          ) : (
            currentSession?.messages.map((m, idx) => (
              <div key={idx} className={`message-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
                <div className="message-bubble">
                  {/* Handle line breaks or code formats inside bubble */}
                  {m.content.split('\n\n').map((para, pIdx) => {
                    // Very simple codeblock matching for display
                    if (para.startsWith('```') && para.endsWith('```')) {
                      const lines = para.split('\n');
                      const code = lines.slice(1, -1).join('\n');
                      return (
                        <pre key={pIdx}>
                          <code>{code}</code>
                        </pre>
                      );
                    }
                    return <p key={pIdx}>{para}</p>;
                  })}

                  {/* Render citations tag if assistant */}
                  {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                    <div className="citations-container">
                      <div className="citations-title">
                        <BookOpen size={12} />
                        <span>Sources Referenced:</span>
                      </div>
                      <div className="citations-list">
                        {m.citations.map((cit, cIdx) => (
                          <div 
                            key={cIdx} 
                            className="citation-tag"
                            onClick={() => handleOpenCitation(cit)}
                          >
                            <FileText size={10} />
                            <span>{cit.file_name} (L{cit.start_line}-{cit.end_line})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {m.isStreaming && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8 }}>
                      <Loader2 className="animate-spin" size={14} style={{ color: 'var(--primary)' }} />
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        {activeRepo && activeRepo.status === 'READY' && (
          <div className="chat-input-container">
            <form onSubmit={handleQuerySubmit}>
              <div className="chat-input-wrapper">
                <textarea 
                  className="chat-textarea"
                  placeholder="Ask a technical question about this codebase..."
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleQuerySubmit(e);
                    }
                  }}
                  disabled={isStreaming}
                />
                <button 
                  type="submit" 
                  className="chat-send-btn"
                  disabled={!questionInput.trim() || isStreaming}
                >
                  {isStreaming ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>

      {/* 3. RADIAL CITATION DRAWER MODAL */}
      {drawerCitation && (
        <>
          <div className="overlay" onClick={() => setDrawerCitation(null)} />
          <div className="citations-modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">Source Reference Code</div>
                <div className="modal-subtitle">{drawerCitation.file_path} (Lines {drawerCitation.start_line}-{drawerCitation.end_line})</div>
              </div>
              <button className="modal-close-btn" onClick={() => setDrawerCitation(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <pre style={{ 
                fontFamily: 'var(--font-mono)', 
                background: '#06070a', 
                padding: 16, 
                borderRadius: 8, 
                overflowX: 'auto',
                border: '1px solid var(--border-color)',
                color: '#e2e8f0',
                fontSize: '0.85rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap'
              }}>
                <code>
                  {drawerCitation.raw_code_content || '// Code snippet loading or not available in citation...'}
                </code>
              </pre>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

export default App;
