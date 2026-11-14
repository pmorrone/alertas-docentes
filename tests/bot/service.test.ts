import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { esc, truncate } from '../../src/bot/html.js';
import { createBotService, type BotService } from '../../src/bot/service.js';
import type { BotReply } from '../../src/bot/types.js';
import {
  createSqliteRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../../src/db/index.js';
import { describeCriteria } from '../../src/nlu/index.js';
import { catalog, interpreter } from '../nlu/helpers.js';

const CHAT = 1001;
const OTHER_CHAT = 2002;

const textOf = (replies: BotReply[]): string => replies.map((r) => r.text).join('\n');
const dataOf = (replies: BotReply[]): string[] =>
  replies.flatMap((r) => (r.buttons ?? []).flat().map((b) => b.data));
const buttonLabels = (replies: BotReply[]): string[] =>
  replies.flatMap((r) => (r.buttons ?? []).flat().map((b) => b.text));

describe('bot service', () => {
  let db: Db;
  let repos: Repositories;
  let service: BotService;
  let clock: number;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repos = createSqliteRepositories(db);
    clock = Date.parse('2026-11-14T12:00:00Z');
    service = createBotService({
      repos,
      interpreter,
      maxAlertsPerUser: 3,
      describeCriteria: (c) => describeCriteria(c, catalog),
      now: () => new Date(clock),
      pendingTtlMs: 60_000,
    });
  });
  afterEach(() => db.close());

  /** Says a sentence and taps "Sí", like a teacher would. */
  async function createAlert(text: string, chat = CHAT): Promise<void> {
    const confirm = await service.text(chat, text);
    expect(dataOf(confirm)).toContain('ok');
    await service.callback(chat, 'ok');
  }

  const alertsOf = async (chat = CHAT) => {
    const teacher = await repos.teachers.findByChatId(chat);
    return teacher ? repos.alerts.listByTeacher(teacher.id) : [];
  };

  describe('start and help', () => {
    it('registers the teacher and explains what to do', async () => {
      const replies = await service.command(CHAT, 'start');

      expect(await repos.teachers.findByChatId(CHAT)).toMatchObject({ active: true });
      expect(textOf(replies)).toContain('alertas APD');
      expect(textOf(replies)).toContain('hasta 3 alertas');
    });

    it('shows help for /ayuda and for the help intent', async () => {
      expect(textOf(await service.command(CHAT, 'help'))).toContain('Cómo funciona');
      expect(textOf(await service.text(CHAT, 'ayuda'))).toContain('Cómo funciona');
    });

    it('answers voice notes honestly', () => {
      expect(textOf(service.voice())).toContain('Todavía no puedo escuchar audios');
    });

    it('does not understand nonsense and says so', async () => {
      expect(textOf(await service.text(CHAT, 'asdfgh'))).toContain('No te entendí');
    });
  });

  describe('creating an alert', () => {
    it('asks for confirmation, then saves the alert with its label', async () => {
      const confirm = await service.text(CHAT, 'historia en pilar a la tarde');

      expect(textOf(confirm)).toContain('Historia · Pilar · Tarde');
      expect(dataOf(confirm)).toEqual(['ok', 'edit']);
      expect(await alertsOf()).toHaveLength(0); // nothing saved before confirming

      const done = await service.callback(CHAT, 'ok');

      expect(textOf(done)).toContain('Listo');
      expect(textOf(done)).toContain('1 de 3 alertas');
      const [alert] = await alertsOf();
      expect(alert).toMatchObject({
        label: 'Historia · Pilar · Tarde',
        active: true,
        criteria: { districts: ['pilar'], areas: ['htr', 'h.i'], shifts: ['T'] },
      });
    });

    it('asks what is missing and completes the alert with the answer', async () => {
      const question = await service.text(CHAT, 'historia a la mañana');
      expect(textOf(question)).toContain('¿En qué distrito');
      expect(dataOf(question)).toEqual([]); // free text expected

      const confirm = await service.text(CHAT, 'en pilar');
      expect(textOf(confirm)).toContain('Historia · Pilar · Mañana');

      await service.callback(CHAT, 'ok');
      expect(await alertsOf()).toHaveLength(1);
    });

    it('offers buttons for ambiguous answers and applies the one tapped', async () => {
      const question = await service.text(CHAT, 'ciencias en tandil');
      expect(buttonLabels(question)).toContain('Ciencias naturales');

      const index = buttonLabels(question).indexOf('Ciencias naturales');
      const confirm = await service.callback(CHAT, `q:${index}`);
      expect(textOf(confirm)).toContain('Ciencias naturales · Tandil');
    });

    it('shows notes about what could not be applied', async () => {
      const confirm = await service.text(CHAT, 'titular de historia en pilar');
      expect(textOf(confirm)).toContain('titular');
    });

    it('"Cambiar" discards the proposal', async () => {
      await service.text(CHAT, 'historia en pilar');
      const edit = await service.callback(CHAT, 'edit');

      expect(textOf(edit)).toContain('contame de nuevo');
      expect(textOf(await service.callback(CHAT, 'ok'))).toContain('ya no está disponible');
      expect(await alertsOf()).toHaveLength(0);
    });

    it('a double tap on "Sí" creates a single alert', async () => {
      await service.text(CHAT, 'historia en pilar');
      await service.callback(CHAT, 'ok');
      const second = await service.callback(CHAT, 'ok');

      expect(textOf(second)).toContain('ya no está disponible');
      expect(await alertsOf()).toHaveLength(1);
    });

    it('refuses duplicates', async () => {
      await createAlert('historia en pilar');
      const again = await service.text(CHAT, 'historia en Pilar');

      expect(textOf(again)).toContain('Ya tenés esa alerta');
      expect(dataOf(again)).not.toContain('ok');
    });

    it('enforces the maximum number of alerts and offers to delete one', async () => {
      await createAlert('historia en pilar');
      await createAlert('geografía en tandil');
      await createAlert('primaria en azul');

      const fourth = await service.text(CHAT, 'inglés en rauch');

      expect(textOf(fourth)).toContain('Ya tenés 3 alertas');
      expect(dataOf(fourth).every((d) => d.startsWith('del:'))).toBe(true);
      expect(await alertsOf()).toHaveLength(3);
    });

    it('survives hitting the limit between proposal and confirmation', async () => {
      const proposal = await service.text(CHAT, 'inglés en rauch');
      expect(dataOf(proposal)).toContain('ok');
      const teacher = (await repos.teachers.findByChatId(CHAT))!;
      const filler = ['historia', 'geografía', 'matemática'];
      for (const [i, area] of filler.entries()) {
        await repos.alerts.create(
          teacher.id,
          { ...interpretCriteria(area, i) },
          new Date(clock),
          3,
        );
      }

      expect(textOf(await service.callback(CHAT, 'ok'))).toContain('Ya tenés 3 alertas');
    });

    it('forgets half-finished conversations after the TTL', async () => {
      await service.text(CHAT, 'historia a la mañana'); // waiting for the district
      clock += 61_000;

      // "pilar" alone is now a brand new request, not the answer to the old question.
      const reply = await service.text(CHAT, 'pilar');
      expect(textOf(reply)).toContain('¿Qué materia, cargo o nivel');
    });
  });

  describe('listing, pausing and deleting', () => {
    it('lists alerts with pause and delete buttons', async () => {
      await createAlert('historia en pilar');
      await createAlert('geografía en tandil');

      const list = await service.command(CHAT, 'list');

      expect(textOf(list)).toContain('Tus alertas</b> (2 de 3)');
      expect(textOf(list)).toContain('1. ▶️ Historia · Pilar');
      expect(textOf(list)).toContain('2. ▶️ Geografía · Tandil');
      const alerts = await alertsOf();
      expect(dataOf(list)).toEqual([
        `pause:${alerts[0]!.id}`,
        `del:${alerts[0]!.id}`,
        `pause:${alerts[1]!.id}`,
        `del:${alerts[1]!.id}`,
      ]);
    });

    it('says so when there are no alerts', async () => {
      expect(textOf(await service.text(CHAT, 'mostrame mis alertas'))).toContain(
        'Todavía no tenés alertas',
      );
    });

    it('pauses and resumes a single alert', async () => {
      await createAlert('historia en pilar');
      const [alert] = await alertsOf();

      const paused = await service.callback(CHAT, `pause:${alert!.id}`);
      expect(textOf(paused)).toContain('(pausada)');
      expect((await alertsOf())[0]!.active).toBe(false);
      expect(dataOf(paused)).toContain(`resume:${alert!.id}`);

      await service.callback(CHAT, `resume:${alert!.id}`);
      expect((await alertsOf())[0]!.active).toBe(true);
    });

    it('deletes by describing it: "borrá la de geografía"', async () => {
      await createAlert('historia en pilar');
      await createAlert('geografía en tandil');

      const ask = await service.text(CHAT, 'borrá la de geografía');
      expect(textOf(ask)).toContain('Geografía · Tandil');
      const confirmData = dataOf(ask).find((d) => d.startsWith('delok:'))!;

      const done = await service.callback(CHAT, confirmData);

      expect(textOf(done)).toContain('Borrada');
      expect((await alertsOf()).map((a) => a.label)).toEqual(['Historia · Pilar']);
    });

    it('asks which one when the description is vague or matches several', async () => {
      await createAlert('historia en pilar');
      await createAlert('geografía en pilar');

      const vague = await service.text(CHAT, 'quiero borrar una alerta');
      expect(textOf(vague)).toContain('¿Cuál querés borrar?');
      expect(dataOf(vague)).toHaveLength(2);

      const several = await service.text(CHAT, 'borrá la de pilar');
      expect(textOf(several)).toContain('varias parecidas');
    });

    it('offers the list when nothing matches the description', async () => {
      await createAlert('historia en pilar');

      const reply = await service.text(CHAT, 'borrá la de inglés');

      expect(textOf(reply)).toContain('No encontré una alerta');
      expect(dataOf(reply)).toHaveLength(1);
    });

    it('deletes all alerts after confirming', async () => {
      await createAlert('historia en pilar');
      await createAlert('geografía en tandil');

      const ask = await service.text(CHAT, 'borrar todas mis alertas');
      expect(dataOf(ask)).toContain('delallok');
      expect(await alertsOf()).toHaveLength(2);

      expect(textOf(await service.callback(CHAT, 'delallok'))).toContain('2 alertas');
      expect(await alertsOf()).toHaveLength(0);
    });

    it("never lets one teacher touch another teacher's alerts", async () => {
      await createAlert('historia en pilar', CHAT);
      const [alert] = await alertsOf(CHAT);
      await service.command(OTHER_CHAT, 'start');

      for (const action of ['pause', 'resume', 'del', 'delok']) {
        const reply = await service.callback(OTHER_CHAT, `${action}:${alert!.id}`);
        expect(textOf(reply)).toContain('ya no está disponible');
      }
      expect(await alertsOf(CHAT)).toHaveLength(1);
      expect((await alertsOf(CHAT))[0]!.active).toBe(true);
    });

    it('ignores malformed callback data', async () => {
      for (const data of ['', 'zzz', 'del:abc', 'q:x', 'pause:']) {
        expect(textOf(await service.callback(CHAT, data))).toContain('ya no está disponible');
      }
    });

    it('still lists or helps in the middle of a question', async () => {
      await createAlert('historia en pilar');
      await service.text(CHAT, 'geografía a la mañana'); // waiting for the district

      expect(textOf(await service.text(CHAT, 'mis alertas'))).toContain('Tus alertas');
    });

    it('"Cancelar" leaves everything as it was', async () => {
      await createAlert('historia en pilar');
      await service.text(CHAT, 'borrar todas mis alertas');

      expect(textOf(await service.callback(CHAT, 'cancel'))).toContain('no hice ningún cambio');
      expect(await alertsOf()).toHaveLength(1);
    });
  });

  describe('pausing everything and leaving', () => {
    it('/pausar and /reanudar toggle all alerts', async () => {
      await service.command(CHAT, 'start');

      await service.command(CHAT, 'pause');
      expect((await repos.teachers.findByChatId(CHAT))!.active).toBe(false);
      await createAlert('historia en pilar');
      expect(textOf(await service.command(CHAT, 'list'))).toContain('pausados');

      await service.command(CHAT, 'resume');
      expect((await repos.teachers.findByChatId(CHAT))!.active).toBe(true);
    });

    it('/baja deletes the teacher and all their data after confirming', async () => {
      await createAlert('historia en pilar');
      const ask = await service.command(CHAT, 'leave');
      expect(await repos.teachers.findByChatId(CHAT)).toBeDefined();

      const done = await service.callback(CHAT, dataOf(ask)[0]!);

      expect(textOf(done)).toContain('borré todos tus datos');
      expect(await repos.teachers.findByChatId(CHAT)).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM alerts').get()).toEqual({ n: 0 });
    });
  });
});

/** Criteria for the filler alerts of the race-condition test (distinct from "inglés en rauch"). */
function interpretCriteria(area: string, index: number) {
  return {
    districts: [`distrito ${index}`],
    levels: [],
    areas: [area],
    shifts: [],
    onlySubstitutes: false,
  };
}

describe('html helpers', () => {
  it('escapes Telegram HTML', () => {
    expect(esc('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('truncates long button labels', () => {
    expect(truncate('x'.repeat(60), 10)).toBe('xxxxxxxxx…');
    expect(truncate('corto')).toBe('corto');
  });
});
