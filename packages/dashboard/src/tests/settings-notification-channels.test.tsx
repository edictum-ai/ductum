import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import { notificationChannelResourceFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings notification channels', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('creates a Telegram channel through config-resource APIs with runtime field names', async () => {
    let rows: unknown[] = []
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/resources/NotificationChannel': () => rows,
      'POST /api/resources/NotificationChannel': ({ init }: { init?: RequestInit }) => {
        const body = JSON.parse(String(init?.body)) as { name: string; spec: { config: Record<string, unknown> } }
        const row = notificationChannelResourceFixture({ id: 'channel_review', name: body.name, spec: { backend: 'telegram', config: body.spec.config } })
        rows = [row]
        return row
      },
    }))

    renderWithProviders(<Settings />)

    const form = await screen.findByTestId('notification-channel-create')
    fireEvent.click(within(form).getByRole('checkbox'))
    fireEvent.change(screen.getByTestId('notification-channel-create-name'), { target: { value: 'review' } })
    fireEvent.change(screen.getByTestId('notification-channel-create-botToken'), { target: { value: 'secret:telegram-bot-token' } })
    fireEvent.change(screen.getByTestId('notification-channel-create-chatId'), { target: { value: '-100456' } })
    fireEvent.change(screen.getByTestId('notification-channel-create-webhookSecret'), { target: { value: '${DUCTUM_TELEGRAM_WEBHOOK_SECRET}' } })
    fireEvent.change(screen.getByTestId('notification-channel-create-publicBaseUrl'), { target: { value: 'https://factory.example.test' } })
    fireEvent.click(screen.getByTestId('notification-channel-create-submit'))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'POST', '/api/resources/NotificationChannel')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'POST', '/api/resources/NotificationChannel')[0] as [RequestInfo, RequestInit])).toEqual({
      name: 'review',
      spec: {
        backend: 'telegram',
        config: {
          enabled: true,
          botToken: 'secret:telegram-bot-token',
          chatId: '-100456',
          webhookSecret: '${DUCTUM_TELEGRAM_WEBHOOK_SECRET}',
          publicBaseUrl: 'https://factory.example.test',
        },
      },
    })
  })

  it('updates and deletes existing channels through resource routes', async () => {
    let rows = [notificationChannelResourceFixture()]
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/resources/NotificationChannel': () => rows,
      'PUT /api/resources/NotificationChannel/channel_ops': ({ init }: { init?: RequestInit }) => {
        const body = JSON.parse(String(init?.body)) as { name: string; spec: { config: Record<string, unknown> } }
        rows = [notificationChannelResourceFixture({ name: body.name, spec: { backend: 'telegram', config: body.spec.config } })]
        return rows[0]
      },
      'DELETE /api/resources/NotificationChannel/channel_ops': () => {
        rows = []
        return { __status: 204 }
      },
    }))

    renderWithProviders(<Settings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit ops' }, { timeout: 20_000 }))
    const form = await screen.findByTestId('notification-channel-edit-ops')
    fireEvent.click(within(form).getByRole('checkbox'))
    fireEvent.change(screen.getByTestId('notification-channel-edit-ops-botToken'), { target: { value: '${DUCTUM_TELEGRAM_BOT_TOKEN}' } })
    fireEvent.change(screen.getByTestId('notification-channel-edit-ops-chatId'), { target: { value: '123456' } })
    fireEvent.change(screen.getByTestId('notification-channel-edit-ops-webhookSecret'), { target: { value: 'secret:telegram-webhook' } })
    fireEvent.click(screen.getByTestId('notification-channel-edit-ops-submit'))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/resources/NotificationChannel/channel_ops')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/resources/NotificationChannel/channel_ops')[0] as [RequestInfo, RequestInit])).toMatchObject({
      name: 'ops',
      spec: {
        backend: 'telegram',
        config: {
          enabled: true,
          botToken: '${DUCTUM_TELEGRAM_BOT_TOKEN}',
          chatId: '123456',
          webhookSecret: 'secret:telegram-webhook',
        },
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Delete ops' }, { timeout: 20_000 }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete ops' }))
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'DELETE', '/api/resources/NotificationChannel/channel_ops')).toHaveLength(1)
    })
  })
})
