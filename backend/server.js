const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Load environment variables from workspace root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_PORT = process.env.PYTHON_PORT || 8000;
const PYTHON_ENGINE_URL = process.env.PYTHON_ENGINE_URL || `http://localhost:${PYTHON_PORT}`;

// Models
const User = require('./models/User');
const Repository = require('./models/Repository');
const ChatSession = require('./models/ChatSession');

// Middlewares
app.use(cors());
app.use(express.json());

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/reporeader';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Middleware to authenticate requests via custom x-user-id header
async function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: User ID is required in headers (x-user-id)' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid User ID' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

// --- Authentication Routes ---

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const user = new User({ username: username.toLowerCase() });
    user.setPassword(password);
    await user.save();

    res.status(201).json({
      message: 'Registration successful',
      user: { id: user._id, username: user.username }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user || !user.validatePassword(password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      message: 'Login successful',
      user: { id: user._id, username: user.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// --- Repository Indexing Routes ---

// Helper to parse owner/repo from GitHub URL
function parseGithubUrl(url) {
  let cleanUrl = url.trim().replace(/\/$/, '');
  if (cleanUrl.endsWith('.git')) {
    cleanUrl = cleanUrl.slice(0, -4);
  }
  const match = cleanUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  let owner = match[1];
  let repo = match[2];
  if (repo.includes('/tree/')) {
    repo = repo.split('/tree/')[0];
  }
  return { owner, repo };
}

app.post('/api/repos/index', requireAuth, async (req, res) => {
  const { repoUrl, githubToken } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ error: 'Repository URL is required' });
  }

  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL' });
  }

  const { owner, repo } = parsed;
  // Generate a deterministic or randomized repoId, scoped per user
  const userIdStr = req.user._id.toString();
  const repoId = `${userIdStr}_${owner.toLowerCase()}_${repo.toLowerCase()}`.replace(/[^a-z0-9_]/g, '_');

  try {
    let repository = await Repository.findOne({ repoId, userId: req.user._id });

    if (repository) {
      // If repository exists and is already ready or indexing, return it
      if (repository.status === 'READY' || repository.status === 'INDEXING') {
        return res.json(repository);
      }
      // If FAILED, reset status to INDEXING to try again
      repository.status = 'INDEXING';
      await repository.save();
    } else {
      repository = new Repository({
        repoId,
        repoUrl,
        owner,
        name: repo,
        userId: req.user._id,
        status: 'INDEXING'
      });
      await repository.save();
    }

    // Call Python AI service to begin indexing
    console.log(`Triggering ingestion on Python microservice for repo: ${repoId}...`);
    axios.post(`${PYTHON_ENGINE_URL}/index-repo`, {
      repo_url: repoUrl,
      repo_id: repoId,
      github_token: githubToken || null
    }).catch(err => {
      console.error(`Python indexing initiation failed for ${repoId}:`, err.message);
      // Fail gracefully or update DB
      repository.status = 'FAILED';
      repository.save();
    });

    res.json(repository);
  } catch (err) {
    console.error('Indexing error:', err);
    res.status(500).json({ error: 'Failed to initialize repository indexing' });
  }
});

app.get('/api/repos', requireAuth, async (req, res) => {
  try {
    const repos = await Repository.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve repositories' });
  }
});

app.get('/api/repos/:repoId', requireAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ repoId: req.params.repoId, userId: req.user._id });
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    res.json(repo);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve repository status' });
  }
});

// Webhook Callback for Python Engine to report indexing completion/failure
app.post('/api/repos/:repoId/callback', async (req, res) => {
  const { repoId } = req.params;
  const { status } = req.body;

  console.log(`Received callback from Python for repo: ${repoId} with status: ${status}`);

  try {
    const repo = await Repository.findOne({ repoId });
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    repo.status = status === 'READY' ? 'READY' : 'FAILED';
    if (status === 'READY') {
      repo.indexedAt = new Date();
    }
    await repo.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Callback handling error:', err);
    res.status(500).json({ error: 'Internal callback processing error' });
  }
});

// --- Chat Session Routes ---

app.post('/api/chats', requireAuth, async (req, res) => {
  const { repoId, title } = req.body;
  if (!repoId) {
    return res.status(400).json({ error: 'Repository ID is required' });
  }

  try {
    // Verify repository belongs to user
    const repo = await Repository.findOne({ repoId, userId: req.user._id });
    if (!repo) {
      return res.status(403).json({ error: 'Access denied to repository' });
    }

    const sessionId = uuidv4();
    const chatSession = new ChatSession({
      sessionId,
      repoId,
      userId: req.user._id,
      title: title || 'New Chat Session',
      messages: []
    });

    await chatSession.save();
    res.status(201).json(chatSession);
  } catch (err) {
    console.error('Error creating chat session:', err);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

app.get('/api/chats/repo/:repoId', requireAuth, async (req, res) => {
  try {
    // Verify repository belongs to user
    const repo = await Repository.findOne({ repoId: req.params.repoId, userId: req.user._id });
    if (!repo) {
      return res.status(403).json({ error: 'Access denied to repository' });
    }

    const sessions = await ChatSession.find({ repoId: req.params.repoId, userId: req.user._id }).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
});

app.get('/api/chats/:sessionId', requireAuth, async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.sessionId, userId: req.user._id });
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat session details' });
  }
});

app.delete('/api/chats/:sessionId', requireAuth, async (req, res) => {
  try {
    const result = await ChatSession.findOneAndDelete({ sessionId: req.params.sessionId, userId: req.user._id });
    if (!result) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    res.json({ success: true, message: 'Chat session deleted successfully' });
  } catch (err) {
    console.error('Error deleting chat session:', err);
    res.status(500).json({ error: 'Failed to delete chat session' });
  }
});

// Streaming Chat API (SSE)
app.post('/api/chats/:sessionId/query', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Question content is required' });
  }

  try {
    const session = await ChatSession.findOne({ sessionId, userId: req.user._id });
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    // Set headers for Server-Sent Events (SSE)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Get chat history excluding current query (only matching roles for LLM)
    const chatHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Call Python FastAPI SSE stream
    console.log(`Piping RAG query stream for session: ${sessionId}...`);
    const pythonResponse = await axios({
      method: 'post',
      url: `${PYTHON_ENGINE_URL}/chat/query`,
      data: {
        repo_id: session.repoId,
        question: question,
        chat_history: chatHistory
      },
      responseType: 'stream'
    });

    let answerText = '';
    let citations = [];
    let buffer = '';

    pythonResponse.data.on('data', (chunk) => {
      // Stream raw event stream blocks to frontend React directly
      res.write(chunk);

      // Parse chunks to accumulate response content for MongoDB storage in background
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Save the last potentially incomplete line back to the buffer
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'token') {
              answerText += data.token;
            } else if (data.type === 'citations') {
              citations = data.citations;
            } else if (data.type === 'error') {
              answerText += `\n❌ Error: ${data.error}`;
            }
          } catch (e) {
            // Ignore incomplete JSON buffers
          }
        }
      }
    });

    pythonResponse.data.on('end', async () => {
      res.end();

      // Append messages to the DB session asynchronously
      try {
        session.messages.push({
          role: 'user',
          content: question
        });
        session.messages.push({
          role: 'assistant',
          content: answerText || "❌ No response generated.",
          citations: citations
        });

        // Auto-update chat session title if it was default
        if (session.title === 'New Chat Session' && session.messages.length <= 2) {
          session.title = question.slice(0, 30) + (question.length > 30 ? '...' : '');
        }

        await session.save();
        console.log(`Saved dialogue history to MongoDB for session ${sessionId}.`);
      } catch (saveErr) {
        console.error('Failed to append messages to history in Mongo:', saveErr);
      }
    });

    pythonResponse.data.on('error', (err) => {
      console.error('Error streaming data from Python engine:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Python microservice stream error' })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('SSE Query proxy error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to process RAG request' })}\n\n`);
    res.end();
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Node.js Express backend running on port ${PORT}`);
});
