import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPEARANCE_STORAGE_KEY,
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  COMPOSER_FONT_SIZE_DEFAULT,
  COMPOSER_FONT_SIZE_MAX,
  COMPOSER_FONT_SIZE_MIN,
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  persistAppearanceSettings,
  readAppearanceSettings
} from './appearance-settings.js'

test('appearance settings normalize font sizes and zoom to supported steps', () => {
  assert.deepEqual(normalizeAppearanceSettings({ chatFontSize: 18.4, composerFontSize: 16.6, chatZoom: 114 }), {
    chatFontSize: 18,
    composerFontSize: 17,
    chatZoom: 110,
    backdrop: 'off'
  })
  assert.equal(normalizeAppearanceSettings({ chatFontSize: 100 }).chatFontSize, CHAT_FONT_SIZE_MAX)
  assert.equal(normalizeAppearanceSettings({ chatFontSize: 1 }).chatFontSize, CHAT_FONT_SIZE_MIN)
  assert.equal(normalizeAppearanceSettings({ chatFontSize: Number.NaN }).chatFontSize, CHAT_FONT_SIZE_DEFAULT)
  assert.equal(normalizeAppearanceSettings({ composerFontSize: 100 }).composerFontSize, COMPOSER_FONT_SIZE_MAX)
  assert.equal(normalizeAppearanceSettings({ composerFontSize: 1 }).composerFontSize, COMPOSER_FONT_SIZE_MIN)
})

test('appearance settings keep the composer size when only chat text is stored', () => {
  assert.equal(normalizeAppearanceSettings({ chatFontSize: 22 }).composerFontSize, COMPOSER_FONT_SIZE_DEFAULT)
})

test('appearance settings read defaults for missing or malformed storage', () => {
  assert.deepEqual(readAppearanceSettings({ getItem: () => null }), DEFAULT_APPEARANCE_SETTINGS)
  assert.deepEqual(readAppearanceSettings({ getItem: () => '{nope' }), DEFAULT_APPEARANCE_SETTINGS)
})

test('appearance settings persist their normalized value', () => {
  let savedKey = ''
  let savedValue = ''
  persistAppearanceSettings({
    setItem(key, value) {
      savedKey = key
      savedValue = value
    }
  }, { chatFontSize: 30, composerFontSize: 12, chatZoom: 83, backdrop: 'desktop' })

  assert.equal(savedKey, APPEARANCE_STORAGE_KEY)
  assert.deepEqual(JSON.parse(savedValue), {
    chatFontSize: CHAT_FONT_SIZE_MAX,
    composerFontSize: COMPOSER_FONT_SIZE_MIN,
    chatZoom: 80,
    backdrop: 'desktop'
  })
})

test('the workspace backdrop is opt-in and ignores unknown values', () => {
  assert.equal(DEFAULT_APPEARANCE_SETTINGS.backdrop, 'off')
  assert.equal(normalizeAppearanceSettings({ backdrop: 'desktop' }).backdrop, 'desktop')
  assert.equal(normalizeAppearanceSettings({ backdrop: 'preset:aurora' }).backdrop, 'preset:aurora')
  assert.equal(normalizeAppearanceSettings({ backdrop: 'preset:nope' }).backdrop, 'off')
  assert.equal(normalizeAppearanceSettings({ backdrop: 'sunset' }).backdrop, 'off')
})
