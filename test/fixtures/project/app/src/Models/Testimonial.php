<?php

namespace App\Models;

use SilverStripe\ORM\DataObject;
use SilverStripe\Assets\Image;

class Testimonial extends DataObject
{
    private static $db = [
        'Quote' => 'Text',
        'Author' => 'Varchar(120)',
    ];

    private static $has_one = [
        'Portrait' => Image::class,
    ];
}
