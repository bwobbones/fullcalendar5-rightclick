import {
  allowContextMenu,
  allowSelection,
  computeRect,
  computeInnerRect,
  constrainPoint,
  diffPoints,
  ElementDragging,
  ElementScrollController,
  Emitter,
  getClippingParents,
  Interaction,
  interactionSettingsToStore,
  isDateSpansEqual,
  mapHash,
  pointInsideRect,
  preventContextMenu,
  preventSelection,
  rangeContainsRange,
  ScrollController,
} from "@fullcalendar/core/internal";

let listenerCnt = 0;
let ignoreMouseDepth = 0;
let isWindowTouchMoveCancelled = false;

class PointerDragging {
  constructor(containerEl) {
    this.subjectEl = null;
    // options that can be directly assigned by caller
    this.selector = ""; // will cause subjectEl in all emitted events to be this element
    this.handleSelector = "";
    this.shouldIgnoreMove = false;
    this.shouldWatchScroll = true; // for simulating pointermove on scroll
    // internal states
    this.isDragging = false;
    this.isTouchDragging = false;
    this.wasTouchScroll = false;
    // Mouse
    // ----------------------------------------------------------------------------------------------------
    this.handleMouseDown = (ev) => {
      if (
        !this.shouldIgnoreMouse() &&
        isPrimaryMouseButton(ev) &&
        this.tryStart(ev)
      ) {
        let pev = this.createEventFromMouse(ev, true);
        this.emitter.trigger("pointerdown", pev);
        this.initScrollWatch(pev);
        if (!this.shouldIgnoreMove) {
          document.addEventListener("mousemove", this.handleMouseMove);
        }
        document.addEventListener("mouseup", this.handleMouseUp);
      }
    };
    this.handleMouseMove = (ev) => {
      let pev = this.createEventFromMouse(ev);
      this.recordCoords(pev);
      this.emitter.trigger("pointermove", pev);
    };
    this.handleMouseUp = (ev) => {
      document.removeEventListener("mousemove", this.handleMouseMove);
      document.removeEventListener("mouseup", this.handleMouseUp);
      this.emitter.trigger("pointerup", this.createEventFromMouse(ev));
      this.cleanup(); // call last so that pointerup has access to props
    };
    // Touch
    // ----------------------------------------------------------------------------------------------------
    this.handleTouchStart = (ev) => {
      if (this.tryStart(ev)) {
        this.isTouchDragging = true;
        let pev = this.createEventFromTouch(ev, true);
        this.emitter.trigger("pointerdown", pev);
        this.initScrollWatch(pev);
        // unlike mouse, need to attach to target, not document
        // https://stackoverflow.com/a/45760014
        let targetEl = ev.target;
        if (!this.shouldIgnoreMove) {
          targetEl.addEventListener("touchmove", this.handleTouchMove);
        }
        targetEl.addEventListener("touchend", this.handleTouchEnd);
        targetEl.addEventListener("touchcancel", this.handleTouchEnd); // treat it as a touch end
        // attach a handler to get called when ANY scroll action happens on the page.
        // this was impossible to do with normal on/off because 'scroll' doesn't bubble.
        // http://stackoverflow.com/a/32954565/96342
        window.addEventListener("scroll", this.handleTouchScroll, true);
      }
    };
    this.handleTouchMove = (ev) => {
      let pev = this.createEventFromTouch(ev);
      this.recordCoords(pev);
      this.emitter.trigger("pointermove", pev);
    };
    this.handleTouchEnd = (ev) => {
      if (this.isDragging) {
        // done to guard against touchend followed by touchcancel
        let targetEl = ev.target;
        targetEl.removeEventListener("touchmove", this.handleTouchMove);
        targetEl.removeEventListener("touchend", this.handleTouchEnd);
        targetEl.removeEventListener("touchcancel", this.handleTouchEnd);
        window.removeEventListener("scroll", this.handleTouchScroll, true); // useCaptured=true
        this.emitter.trigger("pointerup", this.createEventFromTouch(ev));
        this.cleanup(); // call last so that pointerup has access to props
        this.isTouchDragging = false;
        startIgnoringMouse();
      }
    };
    this.handleTouchScroll = () => {
      this.wasTouchScroll = true;
    };
    this.handleScroll = (ev) => {
      if (!this.shouldIgnoreMove) {
        let pageX = window.pageXOffset - this.prevScrollX + this.prevPageX;
        let pageY = window.pageYOffset - this.prevScrollY + this.prevPageY;
        this.emitter.trigger("pointermove", {
          origEvent: ev,
          isTouch: this.isTouchDragging,
          subjectEl: this.subjectEl,
          pageX,
          pageY,
          deltaX: pageX - this.origPageX,
          deltaY: pageY - this.origPageY,
        });
      }
    };
    this.containerEl = containerEl;
    this.emitter = new Emitter();
    containerEl.addEventListener("mousedown", this.handleMouseDown);
    containerEl.addEventListener("touchstart", this.handleTouchStart, {
      passive: true,
    });
    listenerCreated();
  }
  destroy() {
    this.containerEl.removeEventListener("mousedown", this.handleMouseDown);
    this.containerEl.removeEventListener("touchstart", this.handleTouchStart, {
      passive: true,
    });
    listenerDestroyed();
  }
  tryStart(ev) {
    let subjectEl = this.querySubjectEl(ev);
    let downEl = ev.target;
    if (
      subjectEl &&
      (!this.handleSelector || elementClosest(downEl, this.handleSelector))
    ) {
      this.subjectEl = subjectEl;
      this.isDragging = true; // do this first so cancelTouchScroll will work
      this.wasTouchScroll = false;
      return true;
    }
    return false;
  }
  cleanup() {
    isWindowTouchMoveCancelled = false;
    this.isDragging = false;
    this.subjectEl = null;
    // keep wasTouchScroll around for later access
    this.destroyScrollWatch();
  }
  querySubjectEl(ev) {
    if (this.selector) {
      return elementClosest(ev.target, this.selector);
    }
    return this.containerEl;
  }
  shouldIgnoreMouse() {
    return ignoreMouseDepth || this.isTouchDragging;
  }
  // can be called by user of this class, to cancel touch-based scrolling for the current drag
  cancelTouchScroll() {
    if (this.isDragging) {
      isWindowTouchMoveCancelled = true;
    }
  }
  // Scrolling that simulates pointermoves
  // ----------------------------------------------------------------------------------------------------
  initScrollWatch(ev) {
    if (this.shouldWatchScroll) {
      this.recordCoords(ev);
      window.addEventListener("scroll", this.handleScroll, true); // useCapture=true
    }
  }
  recordCoords(ev) {
    if (this.shouldWatchScroll) {
      this.prevPageX = ev.pageX;
      this.prevPageY = ev.pageY;
      this.prevScrollX = window.pageXOffset;
      this.prevScrollY = window.pageYOffset;
    }
  }
  destroyScrollWatch() {
    if (this.shouldWatchScroll) {
      window.removeEventListener("scroll", this.handleScroll, true); // useCaptured=true
    }
  }
  // Event Normalization
  // ----------------------------------------------------------------------------------------------------
  createEventFromMouse(ev, isFirst) {
    let deltaX = 0;
    let deltaY = 0;
    // TODO: repeat code
    if (isFirst) {
      this.origPageX = ev.pageX;
      this.origPageY = ev.pageY;
    } else {
      deltaX = ev.pageX - this.origPageX;
      deltaY = ev.pageY - this.origPageY;
    }
    return {
      origEvent: ev,
      isTouch: false,
      subjectEl: this.subjectEl,
      pageX: ev.pageX,
      pageY: ev.pageY,
      deltaX,
      deltaY,
    };
  }
  createEventFromTouch(ev, isFirst) {
    let touches = ev.touches;
    let pageX;
    let pageY;
    let deltaX = 0;
    let deltaY = 0;
    // if touch coords available, prefer,
    // because FF would give bad ev.pageX ev.pageY
    if (touches && touches.length) {
      pageX = touches[0].pageX;
      pageY = touches[0].pageY;
    } else {
      pageX = ev.pageX;
      pageY = ev.pageY;
    }
    // TODO: repeat code
    if (isFirst) {
      this.origPageX = pageX;
      this.origPageY = pageY;
    } else {
      deltaX = pageX - this.origPageX;
      deltaY = pageY - this.origPageY;
    }
    return {
      origEvent: ev,
      isTouch: true,
      subjectEl: this.subjectEl,
      pageX,
      pageY,
      deltaX,
      deltaY,
    };
  }
}

class OffsetTracker {
  constructor(el) {
    this.origRect = computeRect(el);
    // will work fine for divs that have overflow:hidden
    this.scrollCaches = getClippingParents(el).map(
      (scrollEl) => new ElementScrollGeomCache(scrollEl, true)
    );
  }
  destroy() {
    for (let scrollCache of this.scrollCaches) {
      scrollCache.destroy();
    }
  }
  computeLeft() {
    let left = this.origRect.left;
    for (let scrollCache of this.scrollCaches) {
      left += scrollCache.origScrollLeft - scrollCache.getScrollLeft();
    }
    return left;
  }
  computeTop() {
    let top = this.origRect.top;
    for (let scrollCache of this.scrollCaches) {
      top += scrollCache.origScrollTop - scrollCache.getScrollTop();
    }
    return top;
  }
  isWithinClipping(pageX, pageY) {
    let point = { left: pageX, top: pageY };
    for (let scrollCache of this.scrollCaches) {
      if (
        !isIgnoredClipping(scrollCache.getEventTarget()) &&
        !pointInsideRect(point, scrollCache.clientRect)
      ) {
        return false;
      }
    }
    return true;
  }
}

class ScrollGeomCache extends ScrollController {
  constructor(scrollController, doesListening) {
    super();
    this.handleScroll = () => {
      this.scrollTop = this.scrollController.getScrollTop();
      this.scrollLeft = this.scrollController.getScrollLeft();
      this.handleScrollChange();
    };
    this.scrollController = scrollController;
    this.doesListening = doesListening;
    this.scrollTop = this.origScrollTop = scrollController.getScrollTop();
    this.scrollLeft = this.origScrollLeft = scrollController.getScrollLeft();
    this.scrollWidth = scrollController.getScrollWidth();
    this.scrollHeight = scrollController.getScrollHeight();
    this.clientWidth = scrollController.getClientWidth();
    this.clientHeight = scrollController.getClientHeight();
    this.clientRect = this.computeClientRect(); // do last in case it needs cached values
    if (this.doesListening) {
      this.getEventTarget().addEventListener("scroll", this.handleScroll);
    }
  }
  destroy() {
    if (this.doesListening) {
      this.getEventTarget().removeEventListener("scroll", this.handleScroll);
    }
  }
  getScrollTop() {
    return this.scrollTop;
  }
  getScrollLeft() {
    return this.scrollLeft;
  }
  setScrollTop(top) {
    this.scrollController.setScrollTop(top);
    if (!this.doesListening) {
      // we are not relying on the element to normalize out-of-bounds scroll values
      // so we need to sanitize ourselves
      this.scrollTop = Math.max(Math.min(top, this.getMaxScrollTop()), 0);
      this.handleScrollChange();
    }
  }
  setScrollLeft(top) {
    this.scrollController.setScrollLeft(top);
    if (!this.doesListening) {
      // we are not relying on the element to normalize out-of-bounds scroll values
      // so we need to sanitize ourselves
      this.scrollLeft = Math.max(Math.min(top, this.getMaxScrollLeft()), 0);
      this.handleScrollChange();
    }
  }
  getClientWidth() {
    return this.clientWidth;
  }
  getClientHeight() {
    return this.clientHeight;
  }
  getScrollWidth() {
    return this.scrollWidth;
  }
  getScrollHeight() {
    return this.scrollHeight;
  }
  handleScrollChange() {}
}

class ElementScrollGeomCache extends ScrollGeomCache {
  constructor(el, doesListening) {
    super(new ElementScrollController(el), doesListening);
  }
  getEventTarget() {
    return this.scrollController.el;
  }
  computeClientRect() {
    return computeInnerRect(this.scrollController.el);
  }
}

class HitDragging {
  constructor(dragging, droppableStore) {
    // options that can be set by caller
    this.useSubjectCenter = false;
    this.requireInitial = true; // if doesn't start out on a hit, won't emit any events
    this.initialHit = null;
    this.movingHit = null;
    this.finalHit = null; // won't ever be populated if shouldIgnoreMove
    this.handlePointerDown = (ev) => {
      let { dragging } = this;
      this.initialHit = null;
      this.movingHit = null;
      this.finalHit = null;
      this.prepareHits();
      this.processFirstCoord(ev);
      if (this.initialHit || !this.requireInitial) {
        dragging.setIgnoreMove(false);
        // TODO: fire this before computing processFirstCoord, so listeners can cancel. this gets fired by almost every handler :(
        this.emitter.trigger("pointerdown", ev);
      } else {
        dragging.setIgnoreMove(true);
      }
    };
    this.handleDragStart = (ev) => {
      this.emitter.trigger("dragstart", ev);
      this.handleMove(ev, true); // force = fire even if initially null
    };
    this.handleDragMove = (ev) => {
      this.emitter.trigger("dragmove", ev);
      this.handleMove(ev);
    };
    this.handlePointerUp = (ev) => {
      this.releaseHits();
      this.emitter.trigger("pointerup", ev);
    };
    this.handleDragEnd = (ev) => {
      if (this.movingHit) {
        this.emitter.trigger("hitupdate", null, true, ev);
      }
      this.finalHit = this.movingHit;
      this.movingHit = null;
      this.emitter.trigger("dragend", ev);
    };
    this.droppableStore = droppableStore;
    dragging.emitter.on("pointerdown", this.handlePointerDown);
    dragging.emitter.on("dragstart", this.handleDragStart);
    dragging.emitter.on("dragmove", this.handleDragMove);
    dragging.emitter.on("pointerup", this.handlePointerUp);
    dragging.emitter.on("dragend", this.handleDragEnd);
    this.dragging = dragging;
    this.emitter = new Emitter();
  }
  // sets initialHit
  // sets coordAdjust
  processFirstCoord(ev) {
    let origPoint = { left: ev.pageX, top: ev.pageY };
    let adjustedPoint = origPoint;
    let subjectEl = ev.subjectEl;
    let subjectRect;
    if (subjectEl instanceof HTMLElement) {
      // i.e. not a Document/ShadowRoot
      subjectRect = computeRect(subjectEl);
      adjustedPoint = constrainPoint(adjustedPoint, subjectRect);
    }
    let initialHit = (this.initialHit = this.queryHitForOffset(
      adjustedPoint.left,
      adjustedPoint.top
    ));
    if (initialHit) {
      if (this.useSubjectCenter && subjectRect) {
        let slicedSubjectRect = intersectRects(subjectRect, initialHit.rect);
        if (slicedSubjectRect) {
          adjustedPoint = getRectCenter(slicedSubjectRect);
        }
      }
      this.coordAdjust = diffPoints(adjustedPoint, origPoint);
    } else {
      this.coordAdjust = { left: 0, top: 0 };
    }
  }
  handleMove(ev, forceHandle) {
    let hit = this.queryHitForOffset(
      ev.pageX + this.coordAdjust.left,
      ev.pageY + this.coordAdjust.top
    );
    if (forceHandle || !isHitsEqual(this.movingHit, hit)) {
      this.movingHit = hit;
      this.emitter.trigger("hitupdate", hit, false, ev);
    }
  }
  prepareHits() {
    this.offsetTrackers = mapHash(
      this.droppableStore,
      (interactionSettings) => {
        interactionSettings.component.prepareHits();
        return new OffsetTracker(interactionSettings.el);
      }
    );
  }
  releaseHits() {
    let { offsetTrackers } = this;
    for (let id in offsetTrackers) {
      offsetTrackers[id].destroy();
    }
    this.offsetTrackers = {};
  }
  queryHitForOffset(offsetLeft, offsetTop) {
    let { droppableStore, offsetTrackers } = this;
    let bestHit = null;
    for (let id in droppableStore) {
      let component = droppableStore[id].component;
      let offsetTracker = offsetTrackers[id];
      if (
        offsetTracker && // wasn't destroyed mid-drag
        offsetTracker.isWithinClipping(offsetLeft, offsetTop)
      ) {
        let originLeft = offsetTracker.computeLeft();
        let originTop = offsetTracker.computeTop();
        let positionLeft = offsetLeft - originLeft;
        let positionTop = offsetTop - originTop;
        let { origRect } = offsetTracker;
        let width = origRect.right - origRect.left;
        let height = origRect.bottom - origRect.top;
        if (
          // must be within the element's bounds
          positionLeft >= 0 &&
          positionLeft < width &&
          positionTop >= 0 &&
          positionTop < height
        ) {
          let hit = component.queryHit(
            positionLeft,
            positionTop,
            width,
            height
          );
          if (
            hit &&
            // make sure the hit is within activeRange, meaning it's not a dead cell
            rangeContainsRange(
              hit.dateProfile.activeRange,
              hit.dateSpan.range
            ) &&
            (!bestHit || hit.layer > bestHit.layer)
          ) {
            hit.componentId = id;
            hit.context = component.context;
            // TODO: better way to re-orient rectangle
            hit.rect.left += originLeft;
            hit.rect.right += originLeft;
            hit.rect.top += originTop;
            hit.rect.bottom += originTop;
            bestHit = hit;
          }
        }
      }
    }
    return bestHit;
  }
}

function isPrimaryMouseButton(ev) {
  return ev.button === 0 && !ev.ctrlKey;
}

function listenerCreated() {
  listenerCnt += 1;
  if (listenerCnt === 1) {
    window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
  }
}

function listenerDestroyed() {
  listenerCnt -= 1;
  if (!listenerCnt) {
    window.removeEventListener("touchmove", onWindowTouchMove, {
      passive: false,
    });
  }
}

function onWindowTouchMove(ev) {
  if (isWindowTouchMoveCancelled) {
    ev.preventDefault();
  }
}

function isIgnoredClipping(node) {
  let tagName = node.tagName;
  return tagName === "HTML" || tagName === "BODY";
}

function isHitsEqual(hit0, hit1) {
  if (!hit0 && !hit1) {
    return true;
  }
  if (Boolean(hit0) !== Boolean(hit1)) {
    return false;
  }
  return isDateSpansEqual(hit0.dateSpan, hit1.dateSpan);
}

function buildDatePointApiWithContext(dateSpan, context) {
  let props = {};
  for (let transform of context.pluginHooks.datePointTransforms) {
    Object.assign(props, transform(dateSpan, context));
  }
  Object.assign(props, buildDatePointApi(dateSpan, context.dateEnv));
  return props;
}

function buildDatePointApi(span, dateEnv) {
  return {
    date: dateEnv.toDate(span.range.start),
    dateStr: dateEnv.formatIso(span.range.start, { omitTime: span.allDay }),
    allDay: span.allDay,
  };
}

class AutoScroller {
  constructor() {
    // options that can be set by caller
    this.isEnabled = true;
    this.scrollQuery = [window, ".fc-scroller"];
    this.edgeThreshold = 50; // pixels
    this.maxVelocity = 300; // pixels per second
    // internal state
    this.pointerScreenX = null;
    this.pointerScreenY = null;
    this.isAnimating = false;
    this.scrollCaches = null;
    // protect against the initial pointerdown being too close to an edge and starting the scroll
    this.everMovedUp = false;
    this.everMovedDown = false;
    this.everMovedLeft = false;
    this.everMovedRight = false;
    this.animate = () => {
      if (this.isAnimating) {
        // wasn't cancelled between animation calls
        let edge = this.computeBestEdge(
          this.pointerScreenX + window.pageXOffset,
          this.pointerScreenY + window.pageYOffset
        );
        if (edge) {
          let now = getTime();
          this.handleSide(edge, (now - this.msSinceRequest) / 1000);
          this.requestAnimation(now);
        } else {
          this.isAnimating = false; // will stop animation
        }
      }
    };
  }
  start(pageX, pageY, scrollStartEl) {
    if (this.isEnabled) {
      this.scrollCaches = this.buildCaches(scrollStartEl);
      this.pointerScreenX = null;
      this.pointerScreenY = null;
      this.everMovedUp = false;
      this.everMovedDown = false;
      this.everMovedLeft = false;
      this.everMovedRight = false;
      this.handleMove(pageX, pageY);
    }
  }
  handleMove(pageX, pageY) {
    if (this.isEnabled) {
      let pointerScreenX = pageX - window.pageXOffset;
      let pointerScreenY = pageY - window.pageYOffset;
      let yDelta =
        this.pointerScreenY === null ? 0 : pointerScreenY - this.pointerScreenY;
      let xDelta =
        this.pointerScreenX === null ? 0 : pointerScreenX - this.pointerScreenX;
      if (yDelta < 0) {
        this.everMovedUp = true;
      } else if (yDelta > 0) {
        this.everMovedDown = true;
      }
      if (xDelta < 0) {
        this.everMovedLeft = true;
      } else if (xDelta > 0) {
        this.everMovedRight = true;
      }
      this.pointerScreenX = pointerScreenX;
      this.pointerScreenY = pointerScreenY;
      if (!this.isAnimating) {
        this.isAnimating = true;
        this.requestAnimation(getTime());
      }
    }
  }
  stop() {
    if (this.isEnabled) {
      this.isAnimating = false; // will stop animation
      for (let scrollCache of this.scrollCaches) {
        scrollCache.destroy();
      }
      this.scrollCaches = null;
    }
  }
  requestAnimation(now) {
    this.msSinceRequest = now;
    requestAnimationFrame(this.animate);
  }
  handleSide(edge, seconds) {
    let { scrollCache } = edge;
    let { edgeThreshold } = this;
    let invDistance = edgeThreshold - edge.distance;
    let velocity = // the closer to the edge, the faster we scroll
      ((invDistance * invDistance) / (edgeThreshold * edgeThreshold)) * // quadratic
      this.maxVelocity *
      seconds;
    let sign = 1;
    switch (edge.name) {
      case "left":
        sign = -1;
      // falls through
      case "right":
        scrollCache.setScrollLeft(
          scrollCache.getScrollLeft() + velocity * sign
        );
        break;
      case "top":
        sign = -1;
      // falls through
      case "bottom":
        scrollCache.setScrollTop(scrollCache.getScrollTop() + velocity * sign);
        break;
    }
  }
  // left/top are relative to document topleft
  computeBestEdge(left, top) {
    let { edgeThreshold } = this;
    let bestSide = null;
    let scrollCaches = this.scrollCaches || [];
    for (let scrollCache of scrollCaches) {
      let rect = scrollCache.clientRect;
      let leftDist = left - rect.left;
      let rightDist = rect.right - left;
      let topDist = top - rect.top;
      let bottomDist = rect.bottom - top;
      // completely within the rect?
      if (leftDist >= 0 && rightDist >= 0 && topDist >= 0 && bottomDist >= 0) {
        if (
          topDist <= edgeThreshold &&
          this.everMovedUp &&
          scrollCache.canScrollUp() &&
          (!bestSide || bestSide.distance > topDist)
        ) {
          bestSide = { scrollCache, name: "top", distance: topDist };
        }
        if (
          bottomDist <= edgeThreshold &&
          this.everMovedDown &&
          scrollCache.canScrollDown() &&
          (!bestSide || bestSide.distance > bottomDist)
        ) {
          bestSide = { scrollCache, name: "bottom", distance: bottomDist };
        }
        if (
          leftDist <= edgeThreshold &&
          this.everMovedLeft &&
          scrollCache.canScrollLeft() &&
          (!bestSide || bestSide.distance > leftDist)
        ) {
          bestSide = { scrollCache, name: "left", distance: leftDist };
        }
        if (
          rightDist <= edgeThreshold &&
          this.everMovedRight &&
          scrollCache.canScrollRight() &&
          (!bestSide || bestSide.distance > rightDist)
        ) {
          bestSide = { scrollCache, name: "right", distance: rightDist };
        }
      }
    }
    return bestSide;
  }
  buildCaches(scrollStartEl) {
    return this.queryScrollEls(scrollStartEl).map((el) => {
      if (el === window) {
        return new WindowScrollGeomCache(false); // false = don't listen to user-generated scrolls
      }
      return new ElementScrollGeomCache(el, false); // false = don't listen to user-generated scrolls
    });
  }
  queryScrollEls(scrollStartEl) {
    let els = [];
    for (let query of this.scrollQuery) {
      if (typeof query === "object") {
        els.push(query);
      } else {
        els.push(
          ...Array.prototype.slice.call(
            scrollStartEl.getRootNode().querySelectorAll(query)
          )
        );
      }
    }
    return els;
  }
}

/*
An effect in which an element follows the movement of a pointer across the screen.
The moving element is a clone of some other element.
Must call start + handleMove + stop.
*/
class ElementMirror {
  constructor() {
    this.isVisible = false; // must be explicitly enabled
    this.sourceEl = null;
    this.mirrorEl = null;
    this.sourceElRect = null; // screen coords relative to viewport
    // options that can be set directly by caller
    this.parentNode = document.body; // HIGHLY SUGGESTED to set this to sidestep ShadowDOM issues
    this.zIndex = 9999;
    this.revertDuration = 0;
  }
  start(sourceEl, pageX, pageY) {
    this.sourceEl = sourceEl;
    this.sourceElRect = this.sourceEl.getBoundingClientRect();
    this.origScreenX = pageX - window.pageXOffset;
    this.origScreenY = pageY - window.pageYOffset;
    this.deltaX = 0;
    this.deltaY = 0;
    this.updateElPosition();
  }
  handleMove(pageX, pageY) {
    this.deltaX = pageX - window.pageXOffset - this.origScreenX;
    this.deltaY = pageY - window.pageYOffset - this.origScreenY;
    this.updateElPosition();
  }
  // can be called before start
  setIsVisible(bool) {
    if (bool) {
      if (!this.isVisible) {
        if (this.mirrorEl) {
          this.mirrorEl.style.display = "";
        }
        this.isVisible = bool; // needs to happen before updateElPosition
        this.updateElPosition(); // because was not updating the position while invisible
      }
    } else if (this.isVisible) {
      if (this.mirrorEl) {
        this.mirrorEl.style.display = "none";
      }
      this.isVisible = bool;
    }
  }
  // always async
  stop(needsRevertAnimation, callback) {
    let done = () => {
      this.cleanup();
      callback();
    };
    if (
      needsRevertAnimation &&
      this.mirrorEl &&
      this.isVisible &&
      this.revertDuration && // if 0, transition won't work
      (this.deltaX || this.deltaY) // if same coords, transition won't work
    ) {
      this.doRevertAnimation(done, this.revertDuration);
    } else {
      setTimeout(done, 0);
    }
  }
  doRevertAnimation(callback, revertDuration) {
    let mirrorEl = this.mirrorEl;
    let finalSourceElRect = this.sourceEl.getBoundingClientRect(); // because autoscrolling might have happened
    mirrorEl.style.transition =
      "top " + revertDuration + "ms," + "left " + revertDuration + "ms";
    applyStyle(mirrorEl, {
      left: finalSourceElRect.left,
      top: finalSourceElRect.top,
    });
    whenTransitionDone(mirrorEl, () => {
      mirrorEl.style.transition = "";
      callback();
    });
  }
  cleanup() {
    if (this.mirrorEl) {
      removeElement(this.mirrorEl);
      this.mirrorEl = null;
    }
    this.sourceEl = null;
  }
  updateElPosition() {
    if (this.sourceEl && this.isVisible) {
      applyStyle(this.getMirrorEl(), {
        left: this.sourceElRect.left + this.deltaX,
        top: this.sourceElRect.top + this.deltaY,
      });
    }
  }
  getMirrorEl() {
    let sourceElRect = this.sourceElRect;
    let mirrorEl = this.mirrorEl;
    if (!mirrorEl) {
      mirrorEl = this.mirrorEl = this.sourceEl.cloneNode(true); // cloneChildren=true
      // we don't want long taps or any mouse interaction causing selection/menus.
      // would use preventSelection(), but that prevents selectstart, causing problems.
      mirrorEl.classList.add("fc-unselectable");
      mirrorEl.classList.add("fc-event-dragging");
      applyStyle(mirrorEl, {
        position: "fixed",
        zIndex: this.zIndex,
        visibility: "",
        boxSizing: "border-box",
        width: sourceElRect.right - sourceElRect.left,
        height: sourceElRect.bottom - sourceElRect.top,
        right: "auto",
        bottom: "auto",
        margin: 0,
      });
      this.parentNode.appendChild(mirrorEl);
    }
    return mirrorEl;
  }
}

class FeaturefulElementDragging extends ElementDragging {
  constructor(containerEl, selector) {
    super(containerEl);
    this.containerEl = containerEl;
    // options that can be directly set by caller
    // the caller can also set the PointerDragging's options as well
    this.delay = null;
    this.minDistance = 0;
    this.touchScrollAllowed = true; // prevents drag from starting and blocks scrolling during drag
    this.mirrorNeedsRevert = false;
    this.isInteracting = false; // is the user validly moving the pointer? lasts until pointerup
    this.isDragging = false; // is it INTENTFULLY dragging? lasts until after revert animation
    this.isDelayEnded = false;
    this.isDistanceSurpassed = false;
    this.delayTimeoutId = null;
    this.onPointerDown = (ev) => {
      if (!this.isDragging) {
        // so new drag doesn't happen while revert animation is going
        this.isInteracting = true;
        this.isDelayEnded = false;
        this.isDistanceSurpassed = false;
        preventSelection(document.body);
        preventContextMenu(document.body);
        // prevent links from being visited if there's an eventual drag.
        // also prevents selection in older browsers (maybe?).
        // not necessary for touch, besides, browser would complain about passiveness.
        if (!ev.isTouch) {
          ev.origEvent.preventDefault();
        }
        this.emitter.trigger("pointerdown", ev);
        if (
          this.isInteracting && // not destroyed via pointerdown handler
          !this.pointer.shouldIgnoreMove
        ) {
          // actions related to initiating dragstart+dragmove+dragend...
          this.mirror.setIsVisible(false); // reset. caller must set-visible
          this.mirror.start(ev.subjectEl, ev.pageX, ev.pageY); // must happen on first pointer down
          this.startDelay(ev);
          if (!this.minDistance) {
            this.handleDistanceSurpassed(ev);
          }
        }
      }
    };
    this.onPointerMove = (ev) => {
      if (this.isInteracting) {
        this.emitter.trigger("pointermove", ev);
        if (!this.isDistanceSurpassed) {
          let minDistance = this.minDistance;
          let distanceSq; // current distance from the origin, squared
          let { deltaX, deltaY } = ev;
          distanceSq = deltaX * deltaX + deltaY * deltaY;
          if (distanceSq >= minDistance * minDistance) {
            // use pythagorean theorem
            this.handleDistanceSurpassed(ev);
          }
        }
        if (this.isDragging) {
          // a real pointer move? (not one simulated by scrolling)
          if (ev.origEvent.type !== "scroll") {
            this.mirror.handleMove(ev.pageX, ev.pageY);
            this.autoScroller.handleMove(ev.pageX, ev.pageY);
          }
          this.emitter.trigger("dragmove", ev);
        }
      }
    };
    this.onPointerUp = (ev) => {
      if (this.isInteracting) {
        this.isInteracting = false;
        allowSelection(document.body);
        allowContextMenu(document.body);
        this.emitter.trigger("pointerup", ev); // can potentially set mirrorNeedsRevert
        if (this.isDragging) {
          this.autoScroller.stop();
          this.tryStopDrag(ev); // which will stop the mirror
        }
        if (this.delayTimeoutId) {
          clearTimeout(this.delayTimeoutId);
          this.delayTimeoutId = null;
        }
      }
    };
    let pointer = (this.pointer = new PointerDragging(containerEl));
    pointer.emitter.on("pointerdown", this.onPointerDown);
    pointer.emitter.on("pointermove", this.onPointerMove);
    pointer.emitter.on("pointerup", this.onPointerUp);
    if (selector) {
      pointer.selector = selector;
    }
    this.mirror = new ElementMirror();
    this.autoScroller = new AutoScroller();
  }
  destroy() {
    this.pointer.destroy();
    // HACK: simulate a pointer-up to end the current drag
    // TODO: fire 'dragend' directly and stop interaction. discourage use of pointerup event (b/c might not fire)
    this.onPointerUp({});
  }
  startDelay(ev) {
    if (typeof this.delay === "number") {
      this.delayTimeoutId = setTimeout(() => {
        this.delayTimeoutId = null;
        this.handleDelayEnd(ev);
      }, this.delay); // not assignable to number!
    } else {
      this.handleDelayEnd(ev);
    }
  }
  handleDelayEnd(ev) {
    this.isDelayEnded = true;
    this.tryStartDrag(ev);
  }
  handleDistanceSurpassed(ev) {
    this.isDistanceSurpassed = true;
    this.tryStartDrag(ev);
  }
  tryStartDrag(ev) {
    if (this.isDelayEnded && this.isDistanceSurpassed) {
      if (!this.pointer.wasTouchScroll || this.touchScrollAllowed) {
        this.isDragging = true;
        this.mirrorNeedsRevert = false;
        this.autoScroller.start(ev.pageX, ev.pageY, this.containerEl);
        this.emitter.trigger("dragstart", ev);
        if (this.touchScrollAllowed === false) {
          this.pointer.cancelTouchScroll();
        }
      }
    }
  }
  tryStopDrag(ev) {
    // .stop() is ALWAYS asynchronous, which we NEED because we want all pointerup events
    // that come from the document to fire beforehand. much more convenient this way.
    this.mirror.stop(this.mirrorNeedsRevert, this.stopDrag.bind(this, ev));
  }
  stopDrag(ev) {
    this.isDragging = false;
    this.emitter.trigger("dragend", ev);
  }
  // fill in the implementations...
  setIgnoreMove(bool) {
    this.pointer.shouldIgnoreMove = bool;
  }
  setMirrorIsVisible(bool) {
    this.mirror.setIsVisible(bool);
  }
  setMirrorNeedsRevert(bool) {
    this.mirrorNeedsRevert = bool;
  }
  setAutoScrollEnabled(bool) {
    this.autoScroller.isEnabled = bool;
  }
}

/*
Monitors when the user clicks on a specific date/time of a component.
A pointerdown+pointerup on the same "hit" constitutes a click.
*/
class DateClicking extends Interaction {
  constructor(settings) {
    super(settings);
    this.handlePointerDown = (pev) => {
      let { dragging } = this;
      let downEl = pev.origEvent.target;
      // do this in pointerdown (not dragend) because DOM might be mutated by the time dragend is fired
      dragging.setIgnoreMove(!this.component.isValidDateDownEl(downEl));
    };

    this.handleRightClick = (pev) => {
      let { component } = this;
      this.hitDragging.prepareHits();
      this.hitDragging.processFirstCoord(pev);
      var initialHit = this.hitDragging.initialHit;
      var context = component.context;
      let arg = Object.assign(
        Object.assign(
          {},
          buildDatePointApiWithContext(initialHit.dateSpan, context)
        ),
        {
          dayEl: initialHit.dayEl,
          jsEvent: pev.origEvent,
          view: context.viewApi || context.calendarApi.view,
        }
      );
      context.emitter.trigger("dateClick", arg);

      let { dragging } = this;
      let downEl = pev.origEvent.target;
      // do this in pointerdown (not dragend) because DOM might be mutated by the time dragend is fired
      dragging.setIgnoreMove(!this.component.isValidDateDownEl(downEl));
    };

    // won't even fire if moving was ignored
    this.handleDragEnd = (ev) => {
      let { component } = this;
      let { pointer } = this.dragging;
      if (!pointer.wasTouchScroll) {
        let { initialHit, finalHit } = this.hitDragging;
        if (initialHit && finalHit && isHitsEqual(initialHit, finalHit)) {
          let { context } = component;
          let arg = Object.assign(
            Object.assign(
              {},
              buildDatePointApiWithContext(initialHit.dateSpan, context)
            ),
            {
              dayEl: initialHit.dayEl,
              jsEvent: ev.origEvent,
              view: context.viewApi || context.calendarApi.view,
            }
          );
          context.emitter.trigger("dateClick", arg);
        }
      }
    };
    // we DO want to watch pointer moves because otherwise finalHit won't get populated
    this.dragging = new FeaturefulElementDragging(settings.el);
    this.dragging.autoScroller.isEnabled = false;
    const that = this;
    settings.el.addEventListener("contextmenu", function (ev) {
      var pev = {
        origEvent: ev,
        isTouch: false,
        subjectEl: ev.currentTarget,
        pageX: ev.pageX,
        pageY: ev.pageY,
        deltaX: 0,
        deltaY: 0,
      };
      that.handleRightClick(pev);
    });
    let hitDragging = (this.hitDragging = new HitDragging(
      this.dragging,
      interactionSettingsToStore(settings)
    ));
    hitDragging.emitter.on("pointerdown", this.handlePointerDown);
    hitDragging.emitter.on("dragend", this.handleDragEnd);
    hitDragging.emitter.on("dragend", this.handleDragEnd);
  }
  destroy() {
    this.dragging.destroy();
  }
}

export default DateClicking;
