migrate(
  (app) => {
    ensureAutodateFields(app, app.findCollectionByNameOrId('app_todo_todos'));
    ensureAutodateFields(app, app.findCollectionByNameOrId('app_todo_events'));
  },
  (app) => {
    removeAutodateFields(app, app.findCollectionByNameOrId('app_todo_todos'));
    removeAutodateFields(app, app.findCollectionByNameOrId('app_todo_events'));
  }
);

function ensureAutodateFields(app, collection) {
  if (!collection) return;

  if (!collection.fields.getByName('created')) {
    collection.fields.add(
      new AutodateField({
        hidden: false,
        name: 'created',
        onCreate: true,
        onUpdate: false,
        presentable: false,
        system: true,
      })
    );
  }

  if (!collection.fields.getByName('updated')) {
    collection.fields.add(
      new AutodateField({
        hidden: false,
        name: 'updated',
        onCreate: true,
        onUpdate: true,
        presentable: false,
        system: true,
      })
    );
  }

  return app.save(collection);
}

function removeAutodateFields(app, collection) {
  if (!collection) return;

  if (collection.fields.getByName('created')) {
    collection.fields.removeByName('created');
  }

  if (collection.fields.getByName('updated')) {
    collection.fields.removeByName('updated');
  }

  return app.save(collection);
}
