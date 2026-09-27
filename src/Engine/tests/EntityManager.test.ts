import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityManager } from '../src/core/EntityManager.js';

describe('EntityManager', () => {
  let manager: EntityManager;

  beforeEach(() => {
    manager = new EntityManager();
  });

  it('should spawn entities', () => {
    const entity = manager.spawn({
      type: 'sprite',
      x: 0.5,
      y: 0.5,
    });
    expect(entity).toBeDefined();
    expect(entity.id).toBeDefined();
    expect(entity.state).toBe('active');
  });

  it('should remove entities', () => {
    const entity = manager.spawn({ type: 'sprite', x: 0.5, y: 0.5 });
    manager.remove(entity.id);
    expect(manager.getEntity(entity.id)).toBeUndefined();
  });

  it('should update entity positions', () => {
    const entity = manager.spawn({
      type: 'creature',
      x: 0.5,
      y: 0.5,
      behavior: 'patrol',
      speed: 0.1,
      direction: 0,
    });
    const initialX = entity.currentX;
    manager.update(1000);
    expect(entity.currentX).not.toBe(initialX);
  });

  it('should expire entities after duration', () => {
    const entity = manager.spawn({
      type: 'particle',
      x: 0.5,
      y: 0.5,
      duration: 1,
    });
    manager.update(2000);
    expect(manager.getEntity(entity.id)).toBeUndefined();
  });

  it('should pause and resume', () => {
    const entity = manager.spawn({ type: 'sprite', x: 0.5, y: 0.5 });
    manager.pause();
    expect(entity.state).toBe('paused');
    manager.resume();
    expect(entity.state).toBe('active');
  });

  it('should clear all entities', () => {
    manager.spawn({ type: 'sprite', x: 0.1, y: 0.1 });
    manager.spawn({ type: 'sprite', x: 0.2, y: 0.2 });
    manager.clear();
    expect(manager.getEntities().length).toBe(0);
  });
});
