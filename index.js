import {
  ElementScrollController,
  Emitter,
  Interaction,
  ScrollController,
  computeInnerRect,
  computeRect,
  constrainPoint,
  diffPoints,
  getClippingParents,
  interactionSettingsToStore,
  isDateSpansEqual,
  mapHash,
  pointInsideRect,
  rangeContainsRange
} from "@fullcalendar/common";
import { FeaturefulElementDragging } from "@fullcalendar/interaction";
import { __extends, __assign } from "tslib";

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
  var props = {};
  for (
    var _i = 0, _a = context.pluginHooks.datePointTransforms;
    _i < _a.length;
    _i++
  ) {
    var transform = _a[_i];
    __assign(props, transform(dateSpan, context));
  }
  __assign(props, buildDatePointApi(dateSpan, context.dateEnv));
  return props;
}

function buildDatePointApi(span, dateEnv) {
  return {
    date: dateEnv.toDate(span.range.start),
    dateStr: dateEnv.formatIso(span.range.start, { omitTime: span.allDay }),
    allDay: span.allDay
  };
}

function isIgnoredClipping(node) {
  var tagName = node.tagName;
  return tagName === "HTML" || tagName === "BODY";
}

const ScrollGeomCache = /** @class */ (function(_super) {
  __extends(ScrollGeomCache, _super);
  function ScrollGeomCache(scrollController, doesListening) {
    var _this = _super.call(this) || this;
    _this.handleScroll = function() {
      _this.scrollTop = _this.scrollController.getScrollTop();
      _this.scrollLeft = _this.scrollController.getScrollLeft();
      _this.handleScrollChange();
    };
    _this.scrollController = scrollController;
    _this.doesListening = doesListening;
    _this.scrollTop = _this.origScrollTop = scrollController.getScrollTop();
    _this.scrollLeft = _this.origScrollLeft = scrollController.getScrollLeft();
    _this.scrollWidth = scrollController.getScrollWidth();
    _this.scrollHeight = scrollController.getScrollHeight();
    _this.clientWidth = scrollController.getClientWidth();
    _this.clientHeight = scrollController.getClientHeight();
    _this.clientRect = _this.computeClientRect(); // do last in case it needs cached values
    if (_this.doesListening) {
      _this.getEventTarget().addEventListener("scroll", _this.handleScroll);
    }
    return _this;
  }
  ScrollGeomCache.prototype.destroy = function() {
    if (this.doesListening) {
      this.getEventTarget().removeEventListener("scroll", this.handleScroll);
    }
  };
  ScrollGeomCache.prototype.getScrollTop = function() {
    return this.scrollTop;
  };
  ScrollGeomCache.prototype.getScrollLeft = function() {
    return this.scrollLeft;
  };
  ScrollGeomCache.prototype.setScrollTop = function(top) {
    this.scrollController.setScrollTop(top);
    if (!this.doesListening) {
      // we are not relying on the element to normalize out-of-bounds scroll values
      // so we need to sanitize ourselves
      this.scrollTop = Math.max(Math.min(top, this.getMaxScrollTop()), 0);
      this.handleScrollChange();
    }
  };
  ScrollGeomCache.prototype.setScrollLeft = function(top) {
    this.scrollController.setScrollLeft(top);
    if (!this.doesListening) {
      // we are not relying on the element to normalize out-of-bounds scroll values
      // so we need to sanitize ourselves
      this.scrollLeft = Math.max(Math.min(top, this.getMaxScrollLeft()), 0);
      this.handleScrollChange();
    }
  };
  ScrollGeomCache.prototype.getClientWidth = function() {
    return this.clientWidth;
  };
  ScrollGeomCache.prototype.getClientHeight = function() {
    return this.clientHeight;
  };
  ScrollGeomCache.prototype.getScrollWidth = function() {
    return this.scrollWidth;
  };
  ScrollGeomCache.prototype.getScrollHeight = function() {
    return this.scrollHeight;
  };
  ScrollGeomCache.prototype.handleScrollChange = function() {};
  return ScrollGeomCache;
})(ScrollController);

var ElementScrollGeomCache = /** @class */ (function(_super) {
  __extends(ElementScrollGeomCache, _super);
  function ElementScrollGeomCache(el, doesListening) {
    return (
      _super.call(this, new ElementScrollController(el), doesListening) || this
    );
  }
  ElementScrollGeomCache.prototype.getEventTarget = function() {
    return this.scrollController.el;
  };
  ElementScrollGeomCache.prototype.computeClientRect = function() {
    return computeInnerRect(this.scrollController.el);
  };
  return ElementScrollGeomCache;
})(ScrollGeomCache);

var OffsetTracker = /** @class */ (function() {
  function OffsetTracker(el) {
    this.origRect = computeRect(el);
    // will work fine for divs that have overflow:hidden
    this.scrollCaches = getClippingParents(el).map(function(scrollEl) {
      return new ElementScrollGeomCache(scrollEl, true);
    });
  }
  OffsetTracker.prototype.destroy = function() {
    for (var _i = 0, _a = this.scrollCaches; _i < _a.length; _i++) {
      var scrollCache = _a[_i];
      scrollCache.destroy();
    }
  };
  OffsetTracker.prototype.computeLeft = function() {
    var left = this.origRect.left;
    for (var _i = 0, _a = this.scrollCaches; _i < _a.length; _i++) {
      var scrollCache = _a[_i];
      left += scrollCache.origScrollLeft - scrollCache.getScrollLeft();
    }
    return left;
  };
  OffsetTracker.prototype.computeTop = function() {
    var top = this.origRect.top;
    for (var _i = 0, _a = this.scrollCaches; _i < _a.length; _i++) {
      var scrollCache = _a[_i];
      top += scrollCache.origScrollTop - scrollCache.getScrollTop();
    }
    return top;
  };
  OffsetTracker.prototype.isWithinClipping = function(pageX, pageY) {
    var point = { left: pageX, top: pageY };
    for (var _i = 0, _a = this.scrollCaches; _i < _a.length; _i++) {
      var scrollCache = _a[_i];
      if (
        !isIgnoredClipping(scrollCache.getEventTarget()) &&
        !pointInsideRect(point, scrollCache.clientRect)
      ) {
        return false;
      }
    }
    return true;
  };
  return OffsetTracker;
})();

var HitDragging = /** @class */ (function() {
  function HitDragging(dragging, droppableStore) {
    var _this = this;
    // options that can be set by caller
    this.useSubjectCenter = false;
    this.requireInitial = true; // if doesn't start out on a hit, won't emit any events
    this.initialHit = null;
    this.movingHit = null;
    this.finalHit = null; // won't ever be populated if shouldIgnoreMove
    this.handlePointerDown = function(ev) {
      var dragging = _this.dragging;
      _this.initialHit = null;
      _this.movingHit = null;
      _this.finalHit = null;
      _this.prepareHits();
      _this.processFirstCoord(ev);
      if (_this.initialHit || !_this.requireInitial) {
        dragging.setIgnoreMove(false);
        // TODO: fire this before computing processFirstCoord, so listeners can cancel. this gets fired by almost every handler :(
        _this.emitter.trigger("pointerdown", ev);
      } else {
        dragging.setIgnoreMove(true);
      }
    };
    this.handleDragStart = function(ev) {
      _this.emitter.trigger("dragstart", ev);
      _this.handleMove(ev, true); // force = fire even if initially null
    };
    this.handleDragMove = function(ev) {
      _this.emitter.trigger("dragmove", ev);
      _this.handleMove(ev);
    };
    this.handlePointerUp = function(ev) {
      _this.releaseHits();
      _this.emitter.trigger("pointerup", ev);
    };
    this.handleDragEnd = function(ev) {
      if (_this.movingHit) {
        _this.emitter.trigger("hitupdate", null, true, ev);
      }
      _this.finalHit = _this.movingHit;
      _this.movingHit = null;
      _this.emitter.trigger("dragend", ev);
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
  HitDragging.prototype.processFirstCoord = function(ev) {
    var origPoint = { left: ev.pageX, top: ev.pageY };
    var adjustedPoint = origPoint;
    var subjectEl = ev.subjectEl;
    var subjectRect;
    if (subjectEl !== document) {
      subjectRect = computeRect(subjectEl);
      adjustedPoint = constrainPoint(adjustedPoint, subjectRect);
    }
    var initialHit = (this.initialHit = this.queryHitForOffset(
      adjustedPoint.left,
      adjustedPoint.top
    ));
    if (initialHit) {
      if (this.useSubjectCenter && subjectRect) {
        var slicedSubjectRect = intersectRects(subjectRect, initialHit.rect);
        if (slicedSubjectRect) {
          adjustedPoint = getRectCenter(slicedSubjectRect);
        }
      }
      this.coordAdjust = diffPoints(adjustedPoint, origPoint);
    } else {
      this.coordAdjust = { left: 0, top: 0 };
    }
  };
  HitDragging.prototype.handleMove = function(ev, forceHandle) {
    var hit = this.queryHitForOffset(
      ev.pageX + this.coordAdjust.left,
      ev.pageY + this.coordAdjust.top
    );
    if (forceHandle || !isHitsEqual(this.movingHit, hit)) {
      this.movingHit = hit;
      this.emitter.trigger("hitupdate", hit, false, ev);
    }
  };
  HitDragging.prototype.prepareHits = function() {
    this.offsetTrackers = mapHash(this.droppableStore, function(
      interactionSettings
    ) {
      interactionSettings.component.prepareHits();
      return new OffsetTracker(interactionSettings.el);
    });
  };
  HitDragging.prototype.releaseHits = function() {
    var offsetTrackers = this.offsetTrackers;
    for (var id in offsetTrackers) {
      offsetTrackers[id].destroy();
    }
    this.offsetTrackers = {};
  };
  HitDragging.prototype.queryHitForOffset = function(offsetLeft, offsetTop) {
    var _a = this,
      droppableStore = _a.droppableStore,
      offsetTrackers = _a.offsetTrackers;
    var bestHit = null;
    for (var id in droppableStore) {
      var component = droppableStore[id].component;
      var offsetTracker = offsetTrackers[id];
      if (
        offsetTracker && // wasn't destroyed mid-drag
        offsetTracker.isWithinClipping(offsetLeft, offsetTop)
      ) {
        var originLeft = offsetTracker.computeLeft();
        var originTop = offsetTracker.computeTop();
        var positionLeft = offsetLeft - originLeft;
        var positionTop = offsetTop - originTop;
        var origRect = offsetTracker.origRect;
        var width = origRect.right - origRect.left;
        var height = origRect.bottom - origRect.top;
        if (
          // must be within the element's bounds
          positionLeft >= 0 &&
          positionLeft < width &&
          positionTop >= 0 &&
          positionTop < height
        ) {
          var hit = component.queryHit(
            positionLeft,
            positionTop,
            width,
            height
          );
          var dateProfile = component.context.getCurrentData().dateProfile;
          if (
            hit &&
            // make sure the hit is within activeRange, meaning it's not a deal cell
            rangeContainsRange(dateProfile.activeRange, hit.dateSpan.range) &&
            (!bestHit || hit.layer > bestHit.layer)
          ) {
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
  };
  return HitDragging;
})();

const DateClicking = /** @class */ (function(_super) {
  __extends(DateClicking, _super);
  function DateClicking(settings) {
    var _this = _super.call(this, settings) || this;
    _this.handlePointerDown = function(pev) {
      var dragging = _this.dragging;
      var downEl = pev.origEvent.target;
      // do this in pointerdown (not dragend) because DOM might be mutated by the time dragend is fired
      dragging.setIgnoreMove(!_this.component.isValidDateDownEl(downEl));
    };
    _this.handleRightClick = function(pev) {
      var component = _this.component;
      _this.hitDragging.prepareHits();
      _this.hitDragging.processFirstCoord(pev);
      var initialHit = _this.hitDragging.initialHit;
      var context = component.context;
      var arg = __assign(
        __assign(
          {},
          buildDatePointApiWithContext(initialHit.dateSpan, context)
        ),
        {
          dayEl: initialHit.dayEl,
          jsEvent: pev.origEvent,
          view: context.viewApi || context.calendarApi.view
        }
      );
      context.emitter.trigger("dateClick", arg);
    };
    // won't even fire if moving was ignored
    _this.handleDragEnd = function(ev) {
      var component = _this.component;
      var pointer = _this.dragging.pointer;
      if (!pointer.wasTouchScroll) {
        var _a = _this.hitDragging,
          initialHit = _a.initialHit,
          finalHit = _a.finalHit;
        if (initialHit && finalHit && isHitsEqual(initialHit, finalHit)) {
          var context = component.context;
          var arg = __assign(
            __assign(
              {},
              buildDatePointApiWithContext(initialHit.dateSpan, context)
            ),
            {
              dayEl: initialHit.dayEl,
              jsEvent: ev.origEvent,
              view: context.viewApi || context.calendarApi.view
            }
          );
          context.emitter.trigger("dateClick", arg);
        }
      }
    };
    // we DO want to watch pointer moves because otherwise finalHit won't get populated
    _this.dragging = new FeaturefulElementDragging(settings.el);
    _this.dragging.autoScroller.isEnabled = false;
    settings.el.addEventListener("contextmenu", function(ev) {
      var pev = {
        origEvent: ev,
        isTouch: false,
        subjectEl: ev.currentTarget,
        pageX: ev.pageX,
        pageY: ev.pageY,
        deltaX: 0,
        deltaY: 0
      };
      _this.handleRightClick(pev);
    });
    var hitDragging = (_this.hitDragging = new HitDragging(
      _this.dragging,
      interactionSettingsToStore(settings)
    ));
    hitDragging.emitter.on("pointerdown", _this.handlePointerDown);
    hitDragging.emitter.on("dragend", _this.handleDragEnd);
    return _this;
  }
  DateClicking.prototype.destroy = function() {
    this.dragging.destroy();
  };
  return DateClicking;
})(Interaction);

export default DateClicking;
