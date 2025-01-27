import { createServer } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app, games, playerConnections } from '../src/server';  // Add games and playerConnections

// Mock uuid to have predictable IDs in tests
jest.mock('uuid');
(uuidv4 as jest.Mock).mockImplementation(() => 'test-uuid');

describe('Chess-Poker Game Server', () => {
  let app: express.Application;
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let baseURL: string;

  beforeAll(() => {
    // Initialize express app with middleware before tests
    app.use(express.json());
  });

  beforeEach(() => {
    // Reset game state before each test
    games.clear();
    playerConnections.clear();
    
    // Setup server for each test
    server = createServer(app);
    wss = new WebSocketServer({ server });
    
    // Start server on random port
    server.listen(0);
    const address = server.address() as AddressInfo;
    baseURL = `ws://localhost:${address.port}`;
  });

  afterEach(() => {
    // Cleanup after each test
    wss.close();
    server.close();
  });

  describe('REST API Tests', () => {
    describe('POST /api/games', () => {
      it('should create a new game with initial state', async () => {
        const response = await request(app)
          .post('/api/games')
          .expect(200);

        expect(response.body).toHaveProperty('gameId', 'test-uuid');
        expect(response.body.game).toMatchObject({
          id: 'test-uuid',
          players: {},
          status: 'waiting',
          currentTurn: 'white'
        });
        expect(response.body.game.board).toHaveLength(8);
        expect(response.body.game.deck).toHaveLength(52);
      });
    });

    describe('POST /api/games/:gameId/join', () => {
      it('should allow players to join with different colors', async () => {
        // Create game first
        const createResponse = await request(app)
          .post('/api/games')
          .expect(200);
        
        const gameId = createResponse.body.gameId;

        // Join as white
        const whiteJoinResponse = await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player1', color: 'white' })
          .expect(200);

        expect(whiteJoinResponse.body.players).toMatchObject({
          white: 'player1'
        });

        // Join as black
        const blackJoinResponse = await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player2', color: 'black' })
          .expect(200);

        expect(blackJoinResponse.body.players).toMatchObject({
          white: 'player1',
          black: 'player2'
        });
        expect(blackJoinResponse.body.status).toBe('active');
        expect(blackJoinResponse.body.communityCards).toHaveLength(3);
      });

      it('should prevent joining with already taken color', async () => {
        const { body: { gameId } } = await request(app)
          .post('/api/games')
          .expect(200);

        // First player joins as white
        await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player1', color: 'white' })
          .expect(200);

        // Second player tries to join as white
        await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player2', color: 'white' })
          .expect(400);
      });
    });

    describe('POST /api/games/:gameId/move', () => {
      it('should allow valid moves', async () => {
        // Setup game with two players
        const { body: { gameId } } = await request(app)
          .post('/api/games')
          .expect(200);

        await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player1', color: 'white' })
          .expect(200);

        await request(app)
          .post(`/api/games/${gameId}/join`)
          .send({ playerId: 'player2', color: 'black' })
          .expect(200);

        await request(app)
          .post(`/api/games/${gameId}/move`)
          .send({
            playerId: 'player1',
            move: 'e4'
          })
          .expect(200);
      });
    });
  });
});