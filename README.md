# fullcalendar5-rightclick

Monkey patch to expose right-click events through fullcalendar dateClick

A truly ugly hack to while we wait for https://github.com/fullcalendar/fullcalendar/pull/6044 to be merged.

Now updated to support FullCalendar 6. **If you need to run FullCalendar5 use v1.0.2.**

To install

```
npm i @bwobbones/fullcalendar5-rightclick
```

Use a javascript proxy to patch in the change

```
import DateClicking from '@bwobbones/fullcalendar5-rightclick'
import interactionPlugin from '@fullcalendar/interaction'

const myInteractionPlugin = new Proxy(interactionPlugin, {
  get(target, prop, receiver) {
    if (prop === 'componentInteractions') {
      target.componentInteractions[0] = DateClicking
    }
    return Reflect.get(...arguments)
  }
});
```

Use the `myInteractionPlugin` instead of the `interactionPlugin`

```
data() {
    return {
      calendarOptions: {
        plugins: [myInteractionPlugin]
      }
    }
}
```

Use in the [dateClick](https://fullcalendar.io/docs/dateClick) callback (Vue example):

```
dateClick: (info) => {
  console.log('Clicked on: ' + info.dateStr);
  console.log('Coordinates: ' + info.jsEvent.pageX + ',' + info.jsEvent.pageY);
  console.log('Current view: ' + info.view.type);
  console.log('Dayel', info.dayEl)

  if (info.jsEvent.button === 2) {
    console.log('setting...', info)
    this.currentPasteData = info
  }
},

eventDidMount: info => {
  info.el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    this.$refs.copyMenu.open(ev, info.event)
    return false;
  }, false);
}
```
