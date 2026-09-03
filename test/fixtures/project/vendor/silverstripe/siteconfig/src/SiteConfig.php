<?php

namespace SilverStripe\SiteConfig;

use SilverStripe\ORM\DataObject;

class SiteConfig extends DataObject
{
    private static $db = [
        'Title' => 'Varchar(255)',
        'Tagline' => 'Varchar(255)',
        'ContactUsLink' => 'Varchar(255)',
    ];
}
