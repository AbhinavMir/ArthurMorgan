// src/server.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

export const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// In-memory storage
export const games = new Map<string, GameState>();
export const playerConnections = new Map<string, {ws: WebSocket, gameId: string}>();

// Types
interface GameState {
  id: string;
  players: {
    white?: string;
    black?: string;
  };
  board: (ChessPiece | null)[][];
  communityCards: Card[];
  currentTurn: 'white' | 'black';
  deck: Card[];
  status: 'waiting' | 'active' | 'finished';
}

interface ChessPiece {
  type: 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
  color: 'white' | 'black';
  position: { x: number; y: number };
  card?: Card;
}

interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  value: number | 'J' | 'Q' | 'K' | 'A';
  revealed: boolean;
}

// Add new types
interface Move {
  from: { x: number; y: number };
  to: { x: number; y: number };
  playerId: string;
}

interface GameUpdate {
  type: 'MOVE' | 'CARD_PLAY' | 'GAME_END' | 'PLAYER_JOINED' | 'PLAYER_DISCONNECTED';
  gameId: string;
  data: any;
}

// Helper functions
function createInitialBoard(): ChessPiece[][] {
  const board: ChessPiece[][] = Array(8).fill(null).map(() => Array(8).fill(null));
  
  // Setup piece layouts
  const pieceOrder: ('rook' | 'knight' | 'bishop' | 'queen' | 'king' | 'bishop' | 'knight' | 'rook')[] = 
    ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

  // Place main pieces
  for (let x = 0; x < 8; x++) {
    // Black pieces
    board[0][x] = { 
      type: pieceOrder[x], 
      color: 'black', 
      position: { x, y: 0 } 
    };
    // Black pawns
    board[1][x] = { 
      type: 'pawn', 
      color: 'black', 
      position: { x, y: 1 } 
    };
    
    // White pawns
    board[6][x] = { 
      type: 'pawn', 
      color: 'white', 
      position: { x, y: 6 } 
    };
    // White pieces
    board[7][x] = { 
      type: pieceOrder[x], 
      color: 'white', 
      position: { x, y: 7 } 
    };
  }
  
  console.log('Initial board created with all pieces in starting positions');
  return board;
}

function createDeck(): Card[] {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
  const values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'] as const;
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value, revealed: false });
    }
  }
  
  return shuffleDeck(deck);
}

function shuffleDeck(deck: Card[]): Card[] {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

// REST endpoints
app.post('/api/games', (req, res) => {
  const gameId = uuidv4();
  console.log(`Creating new game with ID: ${gameId}`);
  
  const newGame: GameState = {
    id: gameId,
    players: {},
    board: createInitialBoard(),
    communityCards: [],
    currentTurn: 'white',
    deck: createDeck(),
    status: 'waiting'
  };
  
  games.set(gameId, newGame);
  console.log(`Game ${gameId} initialized with state:`, newGame);
  res.json({
    gameId,
    game: newGame
  });
});

app.get('/api/games/:gameId', (req, res) => {
  const game = games.get(req.params.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json(game);
});

app.post('/api/games/:gameId/join', (req, res) => {
  const { playerId, color } = req.body as { playerId: string; color: 'white' | 'black' };
  const game = games.get(req.params.gameId);
  
  console.log(`Player ${playerId} attempting to join game ${req.params.gameId} as ${color}`);
  
  if (!game) {
    console.warn(`Join attempt failed: Game ${req.params.gameId} not found`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (game.players[color]) {
    console.warn(`Join attempt failed: Color ${color} already taken in game ${req.params.gameId}`);
    return res.status(400).json({ error: 'Color already taken' });
  }
  
  game.players[color] = playerId;
  console.log(`Player ${playerId} successfully joined game ${req.params.gameId} as ${color}`);
  
  if (game.players.white && game.players.black) {
    console.log(`Game ${req.params.gameId} is now active with both players`);
    game.status = 'active';
    // Deal initial cards
    const communityCards = game.deck.splice(0, 3);
    game.communityCards = communityCards.map(card => ({ ...card, revealed: true }));
    console.log(`Dealt community cards:`, game.communityCards);
  }
  
  res.json(game);
});

// Add new endpoints
app.post('/api/games/:gameId/move', (req, res) => {
  const { from, to, playerId } = req.body as Move;
  const game = games.get(req.params.gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Validate player's turn
  const playerColor = Object.entries(game.players).find(([color, id]) => id === playerId)?.[0] as 'white' | 'black';
  if (!playerColor || playerColor !== game.currentTurn) {
    return res.status(400).json({ error: 'Not your turn' });
  }

  // Validate and make move
  const piece = game.board[from.y][from.x];
  if (!piece || piece.color !== playerColor) {
    return res.status(400).json({ error: 'Invalid piece' });
  }

  // Make the move
  game.board[to.y][to.x] = {
    ...piece,
    position: { x: to.x, y: to.y }
  };
  game.board[from.y][from.x] = null;

  // Switch turns
  game.currentTurn = game.currentTurn === 'white' ? 'black' : 'white';

  // Notify all players
  broadcastGameUpdate({
    type: 'MOVE',
    gameId: game.id,
    data: { from, to, piece }
  });

  res.json(game);
});

app.post('/api/games/:gameId/play-card', (req, res) => {
  const { playerId, piecePosition } = req.body;
  const game = games.get(req.params.gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Draw a card from the deck
  const card = game.deck.pop();
  if (!card) {
    return res.status(400).json({ error: 'No cards left in deck' });
  }

  // Assign card to piece
  const piece = game.board[piecePosition.y][piecePosition.x];
  if (piece) {
    piece.card = { ...card, revealed: true };
  }

  broadcastGameUpdate({
    type: 'CARD_PLAY',
    gameId: game.id,
    data: { piecePosition, card }
  });

  res.json(game);
});

// WebSocket handling
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  console.log(`New WebSocket connection established (Client ID: ${clientId})`);
  
  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`Received WebSocket message:`, data);
      
      switch (data.type) {
        case 'JOIN_GAME': {
          const { gameId, playerId } = data;
          playerConnections.set(playerId, { ws, gameId });
          console.log(`Player ${playerId} connected to game ${gameId} via WebSocket`);
          
          // Notify other players
          broadcastGameUpdate({
            type: 'PLAYER_JOINED',
            gameId,
            data: { playerId }
          });
          break;
        }
        
        case 'MOVE_REQUEST': {
          // Handle move requests through WebSocket
          const game = games.get(data.gameId);
          if (game && isValidMove(game, data.move)) {
            // Process move similar to REST endpoint
            const { from, to } = data.move;
            const piece = game.board[from.y][from.x];
            if (!piece) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'No piece at source position' }));
              return;
            }
            game.board[to.y][to.x] = {
              ...piece,
              position: { x: to.x, y: to.y }
            };
            game.board[from.y][from.x] = null;
            
            broadcastGameUpdate({
              type: 'MOVE',
              gameId: data.gameId,
              data: { from, to, piece }
            });
          }
          break;
        }
        
        case 'CARD_PLAY_REQUEST': {
          // Handle card play requests through WebSocket
          const game = games.get(data.gameId);
          if (game) {
            const card = game.deck.pop();
            if (card) {
              const { piecePosition } = data;
              const piece = game.board[piecePosition.y][piecePosition.x];
              if (piece) {
                piece.card = { ...card, revealed: true };
                
                broadcastGameUpdate({
                  type: 'CARD_PLAY',
                  gameId: data.gameId,
                  data: { piecePosition, card }
                });
              }
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket connection closed (Client ID: ${clientId})`);
    // Clean up connection and notify other players
    for (const [playerId, conn] of playerConnections.entries()) {
      if (conn.ws === ws) {
        console.log(`Player ${playerId} disconnected`);
        const gameId = conn.gameId;
        playerConnections.delete(playerId);
        
        broadcastGameUpdate({
          type: 'PLAYER_DISCONNECTED',
          gameId,
          data: { playerId }
        });
        break;
      }
    }
  });
});

// Helper function to validate moves
function isValidMove(game: GameState, move: Move): boolean {
  // Add chess move validation logic here
  // This is a simplified version - you'll want to add proper chess rules
  const { from, to } = move;
  const piece = game.board[from.y][from.x];
  
  // Basic validation
  if (!piece) return false;
  if (to.x < 0 || to.x > 7 || to.y < 0 || to.y > 7) return false;
  
  // Check if destination has a piece of the same color
  const destPiece = game.board[to.y][to.x];
  if (destPiece && destPiece.color === piece.color) return false;
  
  return true;
}

// Helper function to broadcast updates to all players in a game
function broadcastGameUpdate(update: GameUpdate) {
  const gameId = update.gameId;
  for (const [_, conn] of playerConnections.entries()) {
    if (conn.gameId === gameId) {
      conn.ws.send(JSON.stringify(update));
    }
  }
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
