import { describe, expect, it } from 'vitest';
import {
  assistantAvailability,
  assistantInput,
  captionLimit,
  checkOptions,
  suggestCaptions,
  suggestionNote,
  type AssistantGrounding,
} from '@/lib/ai/assistant';
import { fakeProvider } from '@/lib/ai/providers/fake';

const grounding: AssistantGrounding = {
  item: {
    title: 'Autumn feeding tips',
    platformKeys: ['instagram', 'x'],
    countryCode: 'NL',
    format: 'Reel',
    pillar: 'Education',
    audience: 'Hobby growers',
    campaign: 'Autumn',
    ctaType: 'Learn more',
  },
  version: {
    brief: 'Three short tips for feeding in autumn.',
    caption: 'Draft caption',
    cta: 'Read the guide',
    hashtags: ['canna', 'autumn'],
  },
  strategy: {
    name: 'Q4 growth',
    toneOfVoice: 'Friendly, expert, no hype.',
    priorities: ['Education first'],
    pillars: ['Education', 'Community'],
    audiences: ['Hobby growers'],
    objective: 'Gain followers',
  },
};

describe('content assistant', () => {
  it('uses the strictest caption limit of the item’s platforms', () => {
    expect(captionLimit(['instagram'])).toBe(2200);
    expect(captionLimit(['instagram', 'x'])).toBe(280);
    expect(captionLimit([])).toBe(2200);
  });

  it('is only for editors and up on editable, unsubmitted versions', () => {
    const base = { status: 'DRAFT' as const, canEdit: true, currentVersionSubmitted: false };
    expect(assistantAvailability(base)).toEqual({ ok: true });
    expect(assistantAvailability({ ...base, status: 'IDEA' }).ok).toBe(true);
    expect(assistantAvailability({ ...base, status: 'CHANGES_REQUESTED' }).ok).toBe(true);
    expect(assistantAvailability({ ...base, canEdit: false }).ok).toBe(false);
    for (const status of ['IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const) {
      expect(assistantAvailability({ ...base, status }).ok).toBe(false);
    }
    expect(assistantAvailability({ ...base, currentVersionSubmitted: true }).ok).toBe(false);
  });

  it('sends only the item’s own texts and the strategy, no ids', () => {
    const input = assistantInput(grounding);
    expect(input.item.captionLimit).toBe(280);
    expect(input.item.platforms).toEqual(['Instagram', 'X']);
    expect(input.strategy?.toneOfVoice).toBe('Friendly, expert, no hype.');
    const text = JSON.stringify(input);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toMatch(/@/);
  });

  it('keeps options within the limit, without links, at most three', () => {
    const { options, rejected } = checkOptions(
      {
        options: [
          {
            caption: 'Short and good.',
            hashtags: ['#Canna', 'autumn tips'],
            why: 'Follows the tone.',
          },
          { caption: 'x'.repeat(300), hashtags: [], why: '' },
          { caption: 'See https://example.com now', hashtags: [], why: '' },
          { caption: 'Second.', hashtags: [], why: '' },
          { caption: 'Third.', hashtags: [], why: '' },
          { caption: 'Fourth.', hashtags: [], why: '' },
        ],
      },
      280,
    );
    expect(options.map((o) => o.caption)).toEqual(['Short and good.', 'Second.', 'Third.']);
    expect(options[0]!.hashtags).toEqual(['canna', 'autumntips']);
    expect(rejected).toEqual([
      'An option was longer than 280 characters.',
      'An option contained a link.',
    ]);
    expect(checkOptions({ nope: true }, 280).options).toEqual([]);
  });

  it('asks the model and logs what it sent and got', async () => {
    const provider = fakeProvider(() => ({
      options: [
        {
          caption: 'Feed lighter as days get shorter.',
          hashtags: ['canna'],
          why: 'Education pillar.',
        },
        { caption: 'Autumn tip: check your EC weekly.', hashtags: [], why: 'Expert tone.' },
      ],
    }));
    const result = await suggestCaptions({ provider, model: 'gpt-test', grounding });
    expect(result.options).toHaveLength(2);
    expect(result.generation.error).toBeNull();
    expect(provider.requests[0]!.schemaName).toBe('scopie_captions');
    expect(provider.requests[0]!.system).toMatch(/Don't invent facts/);
    expect(JSON.parse(provider.requests[0]!.user).brief).toBe(grounding.version.brief);
  });

  it('gives no options when the model fails', async () => {
    const provider = fakeProvider(() => {
      throw new Error('OpenAI returned 429: slow down');
    });
    const result = await suggestCaptions({ provider, model: 'gpt-test', grounding });
    expect(result.options).toEqual([]);
    expect(result.generation.error).toBe('OpenAI returned 429: slow down');
  });

  it('notes where a saved caption came from', () => {
    expect(
      suggestionNote({
        model: 'gpt-test',
        chosenBy: 'Sam',
        day: '9 Oct 2026',
        previousNotes: 'Old',
      }),
    ).toBe(
      'Old\n\nCaption suggested by the AI model gpt-test on 9 Oct 2026 and chosen by Sam. Check it before submitting for review.',
    );
  });
});
