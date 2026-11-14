import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBotService, type BotService } from '../../src/bot/service.js';
import type { BotReply } from '../../src/bot/types.js';
import {
  createSqliteRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../../src/db/index.js';
import { describeCriteria } from '../../src/nlu/index.js';
import type { OfferSearch } from '../../src/search/offer-search.js';
import { catalog, interpreter } from '../nlu/helpers.js';

const ADMIN = 1;
const ANA = 100;
const BEA = 200;
const CARLOS = 300;
const NOW = new Date('2026-11-14T12:00:00Z');

const textOf = (replies: BotReply[]): string => replies.map((r) => r.text).join('\n');
const codesIn = (replies: BotReply[]): string[] =>
  [...textOf(replies).matchAll(/start=([A-Z0-9]+)/g)].map((m) => m[1] as string);

const idleSearch: OfferSearch = { findMatching: async () => ({ total: 0, offers: [] }) };

describe('pilot access', () => {
  let db: Db;
  let repos: Repositories;
  let service: BotService;
  let nextCode: number;

  const build = (maxUsers: number): BotService =>
    createBotService({
      repos,
      search: idleSearch,
      interpreter,
      maxAlertsPerUser: 3,
      describeCriteria: (c) => describeCriteria(c, catalog),
      now: () => NOW,
      access: {
        adminChatId: ADMIN,
        maxUsers,
        inviteLink: (code) => `https://t.me/test_bot?start=${code}`,
        generateCode: () => `CODE${nextCode++}XYZ`,
      },
    });

  /** Asks the admin for one code and returns it. */
  async function newCode(): Promise<string> {
    const [code] = codesIn(await service.command(ADMIN, 'invite'));
    expect(code).toBeDefined();
    return code as string;
  }

  beforeEach(() => {
    db = openDatabase(':memory:');
    repos = createSqliteRepositories(db);
    nextCode = 1000;
    service = build(2);
  });
  afterEach(() => db.close());

  describe('without a valid code', () => {
    it('answers "estamos en etapa de prueba" and joins the waiting list', async () => {
      const replies = await service.command(ANA, 'start');

      expect(textOf(replies)).toContain('etapa de prueba');
      expect(textOf(replies)).toContain('lista de espera');
      expect(await repos.teachers.findByChatId(ANA)).toBeUndefined();
      expect(await repos.waitlist.count()).toBe(1);
    });

    it('does not let strangers use free text, buttons or voice either', async () => {
      for (const replies of [
        await service.text(ANA, 'historia en tandil a la tarde'),
        await service.callback(ANA, 'ok'),
        await service.voice(ANA),
      ]) {
        expect(textOf(replies)).toMatch(/etapa de prueba|lista de espera/);
        expect(textOf(replies)).not.toContain('Voy a avisarte');
      }
      expect(await repos.teachers.findByChatId(ANA)).toBeUndefined();
      expect(await repos.alerts.count()).toBe(0);
    });

    it('says so once, then just reminds the person they are waiting', async () => {
      await service.command(ANA, 'start');
      const again = await service.command(ANA, 'start');

      expect(textOf(again)).toContain('Ya estás en la lista de espera');
      expect(await repos.waitlist.count()).toBe(1);
    });

    it('rejects an unknown code without registering the person', async () => {
      const replies = await service.command(ANA, 'start', 'NOEXISTE9');

      expect(textOf(replies)).toContain('no es válido o ya fue usado');
      expect(await repos.teachers.findByChatId(ANA)).toBeUndefined();
    });

    it('rejects text that is not even shaped like a code', async () => {
      expect(textOf(await service.command(ANA, 'start', "x'; DROP"))).toContain('no es válido');
    });
  });

  describe('with an invitation', () => {
    it('registers the teacher and welcomes them', async () => {
      const code = await newCode();

      const replies = await service.command(ANA, 'start', code);

      expect(textOf(replies)).toContain('alertas APD');
      expect(await repos.teachers.findByChatId(ANA)).toMatchObject({ active: true });
    });

    it('accepts the code in lower case', async () => {
      const code = await newCode();

      await service.command(ANA, 'start', code.toLowerCase());

      expect(await repos.teachers.findByChatId(ANA)).toBeDefined();
    });

    it('works only once', async () => {
      const code = await newCode();
      await service.command(ANA, 'start', code);

      const replies = await service.command(BEA, 'start', code);

      expect(textOf(replies)).toContain('no es válido o ya fue usado');
      expect(await repos.teachers.findByChatId(BEA)).toBeUndefined();
    });

    it('takes the person off the waiting list', async () => {
      await service.command(ANA, 'start');
      expect(await repos.waitlist.count()).toBe(1);

      await service.command(ANA, 'start', await newCode());

      expect(await repos.waitlist.count()).toBe(0);
    });

    it('lets a registered teacher keep using the bot without the code', async () => {
      await service.command(ANA, 'start', await newCode());

      expect(textOf(await service.text(ANA, 'mostrame mis alertas'))).toContain('no tenés alertas');
      expect(textOf(await service.command(ANA, 'start'))).toContain('alertas APD');
    });

    it('needs a new code to come back after leaving with /baja', async () => {
      const code = await newCode();
      await service.command(ANA, 'start', code);
      await service.callback(ANA, 'leaveok');

      expect(textOf(await service.command(ANA, 'start', code))).toContain('no es válido');
      await service.command(ANA, 'start', await newCode());

      expect(await repos.teachers.findByChatId(ANA)).toBeDefined();
    });
  });

  describe('capacity (MAX_USERS)', () => {
    it('turns people away once the pilot is full and keeps their code unused', async () => {
      await service.command(ANA, 'start', await newCode());
      await service.command(BEA, 'start', await newCode());
      const late = await newCode();

      const replies = await service.command(CARLOS, 'start', late);

      expect(textOf(replies)).toContain('Ya se completaron los lugares');
      expect(await repos.teachers.findByChatId(CARLOS)).toBeUndefined();
      expect(await repos.waitlist.count()).toBe(1);
      expect(await repos.invites.stats()).toEqual({ unused: 1, used: 2 });
    });

    it('frees a spot when a teacher leaves', async () => {
      await service.command(ANA, 'start', await newCode());
      await service.command(BEA, 'start', await newCode());
      await service.callback(ANA, 'leaveok');

      await service.command(CARLOS, 'start', await newCode());

      expect(await repos.teachers.findByChatId(CARLOS)).toBeDefined();
    });
  });

  describe('admin', () => {
    it('can use the bot without a code', async () => {
      expect(textOf(await service.command(ADMIN, 'start'))).toContain('alertas APD');
      expect(await repos.teachers.findByChatId(ADMIN)).toBeDefined();
    });

    it('creates deep links with one-use codes', async () => {
      const replies = await service.command(ADMIN, 'invite');

      expect(textOf(replies)).toContain('https://t.me/test_bot?start=CODE1000XYZ');
      expect(await repos.invites.stats()).toEqual({ unused: 1, used: 0 });
    });

    it('creates several codes, capped at 10', async () => {
      expect(codesIn(await service.command(ADMIN, 'invite', '3'))).toHaveLength(3);
      expect(codesIn(await service.command(ADMIN, 'invite', '500'))).toHaveLength(10);
      expect(codesIn(await service.command(ADMIN, 'invite', '0'))).toHaveLength(1);
      expect(codesIn(await service.command(ADMIN, 'invite', 'muchos'))).toHaveLength(1);
    });

    it('reports usage and cost', async () => {
      await service.command(ADMIN, 'invite', '2');
      await service.command(ANA, 'start', 'CODE1000XYZ');
      await service.text(ANA, 'historia en tandil a la tarde');
      await service.callback(ANA, 'ok');
      await service.command(BEA, 'start');

      const report = textOf(await service.command(ADMIN, 'status'));

      expect(report).toContain('Docentes: 1 de 2');
      expect(report).toContain('Alertas: 1');
      expect(report).toContain('Códigos sin usar: 1 (usados: 1)');
      expect(report).toContain('Lista de espera: 1');
      expect(report).toContain('$0');
    });

    it('is not available to anyone else, even registered teachers', async () => {
      await service.command(ANA, 'start', await newCode());
      const before = await repos.invites.stats();

      const invite = await service.command(ANA, 'invite');
      const status = await service.command(ANA, 'status');

      expect(textOf(invite)).toContain('Cómo funciona'); // treated like an unknown command
      expect(textOf(status)).not.toContain('Estado del piloto');
      expect(codesIn(invite)).toEqual([]);
      expect(await repos.invites.stats()).toEqual(before);
    });

    it('does not reveal the admin commands to strangers', async () => {
      const replies = await service.command(BEA, 'invite');

      expect(textOf(replies)).toContain('etapa de prueba');
      expect(await repos.invites.stats()).toEqual({ unused: 0, used: 0 });
    });
  });

  it('stays open to everyone when no access policy is configured', async () => {
    const open = createBotService({
      repos,
      search: idleSearch,
      interpreter,
      maxAlertsPerUser: 3,
      describeCriteria: (c) => describeCriteria(c, catalog),
    });

    expect(textOf(await open.command(ANA, 'start'))).toContain('alertas APD');
    expect(textOf(await open.command(ANA, 'invite'))).toContain('Cómo funciona');
  });
});
