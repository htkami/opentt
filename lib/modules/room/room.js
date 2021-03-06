var EventEmitter    = require('events').EventEmitter;
var util            = require( 'util' );
var mongoose        = require( 'mongoose' );

function Room( room )
{
    this.room       = room;
    this.users      = [];
    this.listeners  = [];
    this.songLog    = [];
    this.voteLog    = [];
    this.current_dj = null;
    this.djs        = [];
    this.upvotes    = 0;
    this.downvotes  = 0;
}

util.inherits( Room, EventEmitter );

Room.prototype.init = function()
{
    this.events.on( 'avatar', this.onAvatar.bind( this ) );
    this.events.on( 'screens', this.onScreens.bind( this ) );
}

Room.prototype.join = function( handler, callback )
{
    this.emit( 'join', handler );

    this.users.push( handler );
    this.listeners.push( handler );

    callback( this );
}

Room.prototype.leave = function( handler )
{
    this.remDJ( handler );
    this.emit( 'leave', handler );

    var userIndex       = this.users.indexOf( handler );
    var listenerIndex   = this.listeners.indexOf( handler );

    if ( userIndex != -1 )
    {
        this.users.splice( userIndex, 1 );
    }

    if ( listenerIndex != -1 )
    {
        this.listeners.splice( listenerIndex, 1 );
    }
};

Room.prototype.getUsers = function()
{
    var users   = [];

    this.users.forEach( function( handler )
    {
        users.push( handler.user.toJSON() );
    } );

    return users;
}

Room.prototype.toJSON = function()
{
    var json = {
        name: 					this.room.name,
        roomid: 				this.room.id,
        created: 				this.room.created.getTime() * 0.001,
        shortcut: 				this.room.shortcut,
        name_lower: 			this.room.name.toLowerCase(),
        metadata:
        {
            privacy: 			this.room.privacy,

            songlog: 			this.songLog,
            votelog: 			this.voteLog,

            current_dj: 		this.getCurrentDJ(),
            djs: 				this.getDJs(),
            listeners: 			this.getListeners(),

            upvotes: 			this.upvotes,
            downvotes: 			this.downvotes,

            max_djs: 			this.room.maxDJs,
            sticker_placements: this.getStickerPlacements(),

            screens:            this.room.screens,

            "creator":
            {
                "name": "@Masque",
                "created": 1307587096.74,
                "laptop": "mac",
                "userid": "4df032194fe7d063190425ca",
                "acl": 1,
                "fans": 1125,
                "points": 17336,
                "avatarid": 26
            },
        }
    }

    if ( this.currentSong )
    {
        json.metadata.current_song	= this.getCurrentSong();
    }

    return json;
}

Room.prototype.getStickerPlacements = function()
{
    var json    = {};

    this.djs.forEach( function( handler )
    {
        json[ handler.user.id ] = [];
    } );

    return json;
}

Room.prototype.getListeners = function()
{
    var users   = [];

    this.listeners.forEach( function( handler )
    {
        users.push( handler.user.id );
    } );

    return users;
}

Room.prototype.getDJs = function()
{
    var users   = [];

    this.djs.forEach( function( handler )
    {
        users.push( handler.user.id );
    } );

    return users;
}

Room.prototype.speak = function( handler, text )
{
    this.emit( 'speak', handler, text );
}

Room.prototype.onAvatar = function( id, avatarid )
{
    var handler = this.getHandlerById( id );

    if ( handler != null )
    {
        handler.user.avatarid   = avatarid;
        this.emit( 'avatar', handler, avatarid );
    }
};

Room.prototype.onScreens = function( id, screens )
{
    if ( this.room.id == id )
    {
        this.room.screens   = screens;
        this.emit( 'screens', screens );
    }
}

Room.prototype.getHandlerById = function( id )
{
    var handler = null;

    this.users.forEach( function( h )
    {
        if ( h.user.id == id )
        {
            handler = h;
        }
    } );

    return handler;
}

Room.prototype.addDJ = function( handler )
{
    var success = false;

    if ( this.djs.length < this.room.maxDJs && this.djs.indexOf( handler) == -1 )
    {
        this.djs.push( handler );

        var index   = this.listeners.indexOf( handler );
        if ( index != -1 )
        {
            this.listeners.splice( index, 1 );
        }

        this.emit( 'add_dj', handler );
        success = true;

        if ( this.currentDJ == null )
        {
            this.currentDJIndex = -1;
            this.nextSong();
        }
    }

    return success;
}

Room.prototype.remDJ = function( handler )
{
    var success = false;
    var index = this.djs.indexOf( handler );

    if ( index != -1 )
    {
        success = true;

        this.djs.splice( index, 1 );
        this.listeners.push( handler );

        if ( index <= this.currentDJIndex )
        {
            --this.currentDJIndex;
        }

        if ( this.currentDJ == handler )
        {
            this.nextSong();
        }

        this.emit( 'rem_dj', handler );
    }

    return success;
}

Room.prototype.nextSong = function ()
{
    var _this           = this;

    if ( this.songTimer != null )
    {
        clearTimeout( this.songTimer );
        this.songTimer  = null;
    }

    if ( this.currentDJ )
    {
        this.currentDJ.isCurrentlyDJing = false;

        var points          = this.upvotes - this.downvotes;
        if ( points > 0 )
        {
            this.currentDJ.user.points += points;
            this.db.user.update({ _id: this.currentDJ.user._id }, { "$inc": { "points" : points } }, function( err )
            {
                if ( err )
                {
                    console.error( 'error saving dj\'s points:', err );
                }
            });
        }
    }

    var _this               = this;
    this.currentSong        = null;
    this.currentDJ          = null;
    this.currentPlaylist    = null;
    this.voteLog            = [ ];
    this.upvotes            = 0;
    this.downvotes          = 0;

    this.events.emit( 'songEnd' );

    if ( this.djs.length == 0 )
    {
        this.emit( 'song', null );
        return;
    }

    if ( ++this.currentDJIndex >= this.djs.length )
    {
        this.currentDJIndex = 0;
    }

    this.currentDJ          = this.djs[ this.currentDJIndex ];
    this.currentDJ.isCurrentlyDJing = true;
    this.currentPlaylist    = this.currentDJ.user.activePlaylist;

    this.upvotes            = 1;
    this.voteLog            = [ [ this.currentDJ.user.id, 'up' ] ];

    this.db.playlist.findOne({ _id: this.currentPlaylist })
    .exec( function( err, playlist )
    {
        if ( !err && playlist )
        {
            _this.currentPlaylistName   = playlist.name;
            var songId                  = playlist.songs.shift();
            playlist.songs.push( songId );
            playlist.markModified( 'songs' );
            playlist.save( function( err )
            {
                if ( err )
                {
                    console.error( 'error saving playlist for current DJ:', err );
                }
            } );

            _this.db.song.findOne( { _id: songId }, function( err, song )
            {
                if ( !err && song )
                {
                    _this.currentSong    = song;
                    _this.startTime      = Date.now();
                    _this.songTimer      = setTimeout( _this.nextSong.bind( _this ), _this.currentSong.length );
                    _this.songLog.push(  _this.getCurrentSong() );
                    _this.events.emit( 'song', _this.currentSong );
                    _this.emit( 'song', _this.currentSong );
                }
                else if ( err )
                {
                    console.error( 'error finding song for current DJ:', err );
                }
            } );
        }
        else if ( err )
        {
            console.error( 'error loading playlist for current DJ:', err );
        }
        else
        {
            console.error( 'couldn\'t find playlist for current DJ' );
        }
    } );
}

Room.prototype.getCurrentDJ = function()
{
    return this.currentDJ ? this.currentDJ.user.id : null;
}

Room.prototype.getCurrentSong = function()
{
    var obj 			= this.currentSong.toJSON();

    obj.djid 			= this.currentDJ.user.id;
    obj.djname 			= this.currentDJ.user.name;
    obj.starttime 		= this.startTime * 0.001;
    obj.playlist        = this.currentPlaylistName;

    return obj;
}

Room.prototype.snag = function( handler, songId, callback )
{
    this.emit( 'snagged', handler );
};

Room.prototype.stopSong = function( stopper )
{
    if ( this.currentDJ != null && this.currentSong != null )
    {
        this.emit( 'stop_song', stopper );
        this.nextSong();
    }
}

Room.prototype.vote = function( handler, vote )
{
    if ( vote == 'up' )
    {
        ++this.upvotes;
    }
    else
    {
        ++this.downvotes;
    }

    this.voteLog.push( [ handler.user.id, vote ] );
    this.emit( 'vote' );
}

module.exports = Room;
